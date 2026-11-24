"""Owner session endpoints; setup links are issued only by the local CLI."""

import hmac
from typing import cast
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from researchchain.access_models import (
    AccessError,
    AccessStatus,
    LinkExchange,
    PasswordChange,
    PasswordLogin,
    SignOutResult,
)
from researchchain.access_service import AccessService, IssuedSession

CSRF_HEADER = "X-ResearchChain-CSRF"
PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/access/status"),
    ("POST", "/api/access/login"),
    ("POST", "/api/access/exchange"),
}


def token_from(request: Request, access: AccessService) -> str | None:
    return request.cookies.get(access.config.cookie_name)


def clear_cookie(response: Response, access: AccessService) -> None:
    # Only explicit sign-out clears the cookie. A denial for an old request can
    # arrive after another tab has already installed the replacement session.
    response.delete_cookie(
        access.config.cookie_name,
        path="/",
        secure=access.config.secure,
        httponly=True,
        samesite="strict",
    )


def session_response(
    issued: IssuedSession, response: Response, access: AccessService
) -> AccessStatus:
    response.set_cookie(
        access.config.cookie_name,
        issued.token.get_secret_value(),
        max_age=access.config.session_seconds,
        path="/",
        secure=access.config.secure,
        httponly=True,
        samesite="strict",
    )
    return issued.status


def access_router(access: AccessService) -> APIRouter:
    router = APIRouter(prefix="/api/access", tags=["Owner access"])

    @router.get("/status", response_model=AccessStatus, operation_id="owner_access_status")
    def status(request: Request) -> AccessStatus:
        return access.status(token_from(request, access))

    @router.post("/exchange", response_model=AccessStatus, operation_id="exchange_owner_link")
    def exchange(body: LinkExchange, request: Request, response: Response) -> AccessStatus:
        return session_response(
            access.exchange(body.code.get_secret_value(), token_from(request, access)),
            response,
            access,
        )

    @router.post("/login", response_model=AccessStatus, operation_id="owner_password_login")
    def login(body: PasswordLogin, request: Request, response: Response) -> AccessStatus:
        return session_response(
            access.login(body.password.get_secret_value(), token_from(request, access)),
            response,
            access,
        )

    @router.post("/password", response_model=AccessStatus, operation_id="change_owner_password")
    def password(body: PasswordChange, request: Request, response: Response) -> AccessStatus:
        token = token_from(request, access)
        assert token  # The outer authorization layer has already admitted this request.
        issued = access.set_password(
            token,
            body.password.get_secret_value(),
            body.current_password.get_secret_value() if body.current_password else None,
        )
        return session_response(issued, response, access)

    @router.post("/logout", response_model=SignOutResult, operation_id="owner_logout")
    def logout(request: Request, response: Response) -> SignOutResult:
        access.revoke(token_from(request, access))
        clear_cookie(response, access)
        return SignOutResult()

    @router.post("/logout-all", response_model=SignOutResult, operation_id="owner_logout_all")
    def logout_all(response: Response) -> SignOutResult:
        access.revoke(all_sessions=True)
        clear_cookie(response, access)
        return SignOutResult()

    return router


class AccessMiddleware:
    """Deny by default before parsing input or touching any research repository."""

    def __init__(self, app: ASGIApp, access: AccessService):
        self.app, self.access = app, access

    def check_browser_boundary(self, headers: Headers, method: str) -> None:
        hosts = headers.getlist("host")
        if len(hosts) != 1 or any(c.isspace() or c in "/\\,@#?" for c in hosts[0]):
            raise AccessError("Invalid request host.", 400)
        try:
            parsed = urlsplit("//" + hosts[0])
            if parsed.hostname not in self.access.config.hosts or parsed.port == 0:
                raise ValueError
        except ValueError:
            raise AccessError("Invalid request host.", 400) from None
        origins = headers.getlist("origin")
        if len(origins) > 1:
            raise AccessError("State changes require one workbench origin.", 403)
        origin = headers.get("origin")
        if origin is not None and origin != self.access.config.origin:
            raise AccessError("This request did not come from the workbench origin.", 403)
        if headers.get("sec-fetch-site") in {"cross-site", "same-site"}:
            raise AccessError("Open this resource from the workbench.", 403)
        if method not in {"GET", "HEAD", "OPTIONS"} and origin != self.access.config.origin:
            raise AccessError("State changes require the workbench origin.", 403)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        method, path = scope["method"], scope["path"]
        request = Request(scope)

        async def private_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["Cache-Control"] = "no-store, private"
                response_headers["Pragma"] = "no-cache"
                response_headers["X-Content-Type-Options"] = "nosniff"
                response_headers["X-Frame-Options"] = "DENY"
                response_headers["Referrer-Policy"] = "no-referrer"
                response_headers.add_vary_header("Cookie")
                if self.access.config.secure:
                    response_headers["Strict-Transport-Security"] = "max-age=31536000"
            await send(message)

        try:
            self.check_browser_boundary(headers, method)
            if (method, path) not in PUBLIC:
                status = await run_in_threadpool(
                    self.access.status,
                    token_from(request, self.access),
                    touch=True,
                )
                if not status.session:
                    raise AccessError("Sign in to open this workspace.")
                if method not in {"GET", "HEAD", "OPTIONS"}:
                    submitted = headers.get(CSRF_HEADER, "")
                    if len(headers.getlist(CSRF_HEADER)) != 1 or not hmac.compare_digest(
                        submitted.encode("utf-8"), status.session.csrf_token.encode("ascii")
                    ):
                        raise AccessError(
                            "The session changed. Refresh access before trying again.", 403
                        )
                scope.setdefault("state", {})["owner_session"] = status.session
            limit = 4096 if path.startswith("/api/access/") else 20 * 1024 * 1024
            lengths = headers.getlist("content-length")
            if lengths:
                try:
                    if len(lengths) != 1 or int(lengths[0]) < 0:
                        raise ValueError
                    if int(lengths[0]) > limit:
                        raise AccessError("Request body exceeds the size limit.", 413)
                except ValueError:
                    raise AccessError("Invalid request body length.", 400) from None
            size = 0

            async def limited_receive() -> Message:
                nonlocal size
                message = await receive()
                if message["type"] == "http.request":
                    size += len(cast(bytes, message.get("body", b"")))
                    if size > limit:
                        raise HTTPException(413, "Request body exceeds the size limit.")
                return message

            await self.app(scope, limited_receive, private_send)
        except AccessError as error:
            response = JSONResponse({"detail": str(error)}, status_code=error.status)
            if error.status == 429:
                response.headers["Retry-After"] = "60"
            await response(scope, receive, private_send)
