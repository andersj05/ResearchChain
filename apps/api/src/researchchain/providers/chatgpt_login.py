"""Short-lived loopback browser sign-in. No OAuth URLs or callbacks are logged."""

import html
import secrets
import time
import webbrowser
from collections.abc import Callable
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

from researchchain.providers.chatgpt_auth import PLAN_SCOPE, ChatGPTAuth
from researchchain.providers.credentials import Account, ConnectionError

STYLE = """body{font:16px system-ui;margin:64px auto;padding:0 24px;max-width:600px;
color:#171717;background:#fafafa}h1{font-size:28px}p{line-height:1.6}button,a.button{
background:#171717;color:white;border:0;padding:14px 20px;font:inherit;cursor:pointer}
a{color:#333}small{display:block;color:#555;margin-top:32px}form{margin:28px 0}"""


def browser_login(
    auth: ChatGPTAuth,
    account_id: str | None = None,
    *,
    new: bool = False,
    consent: bool = False,
    open_browser: Callable[[str], object] = webbrowser.open,
    announce: Callable[[str], object] = print,
) -> Account:
    result: Account | None = None
    failure: ConnectionError | None = None
    finished = False
    entry = secrets.token_urlsafe(24)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            pass  # Callback query strings and retained ID-token hints are secrets.

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(5)

        def respond(
            self, title: str, content: str, status: int = 200, cookie: bool = False
        ) -> None:
            document = (
                f'<!doctype html><html lang="en"><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width,initial-scale=1">'
                f"<title>{html.escape(title)} · ResearchChain</title>"
                f"<style>{STYLE}</style><main><small>ResearchChain</small>"
                f"<h1>{html.escape(title)}</h1>{content}</main></html>"
            ).encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(document)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; style-src 'unsafe-inline'; "
                "form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            )
            if cookie:
                self.send_header(
                    "Set-Cookie",
                    f"rc_signin={pending.browser_secret}; "
                    "HttpOnly; SameSite=Lax; Path=/; Max-Age=600",
                )
            else:
                self.send_header(
                    "Set-Cookie", "rc_signin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
                )
            self.end_headers()
            self.wfile.write(document)

        def local_request(self) -> bool:
            return self.headers.get("Host") == f"127.0.0.1:{server.server_port}"

        def bound_browser(self) -> bool:
            cookies = SimpleCookie()
            try:
                cookies.load(self.headers.get("Cookie", ""))
                cookie = cookies.get("rc_signin")
                return cookie is not None and secrets.compare_digest(
                    cookie.value, pending.browser_secret
                )
            except Exception:
                return False

        def do_POST(self) -> None:
            if (
                not self.local_request()
                or self.path != f"/continue/{entry}"
                or not self.bound_browser()
                or self.headers.get("Origin") != origin
            ):
                self.respond(
                    "Sign-in unavailable", "<p>Restart sign-in from ResearchChain.</p>", 403
                )
                return
            self.send_response(303)
            self.send_header("Location", pending.authorize_url())
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            nonlocal result, failure, finished
            if not self.local_request():
                self.respond("Invalid local address", "<p>Restart sign-in.</p>", 400)
                return
            parsed = urlsplit(self.path)
            if parsed.path == f"/start/{entry}" and not parsed.query:
                self.respond(
                    "Use your ChatGPT plan",
                    "<p>Connect your ChatGPT account to use its included allowance for "
                    "eligible ResearchChain requests.</p>"
                    "<p>Allow plan usage on the next screen. Leave credit use disabled "
                    "if you want to stay within your included allowance.</p>"
                    f'<form method="post" action="/continue/{entry}">'
                    "<button data-oai-siwc-button>Continue with ChatGPT</button></form>"
                    '<p><a href="https://chatgpt.com/settings/usage" target="_blank" '
                    'rel="noreferrer">Manage usage in ChatGPT</a></p>',
                    cookie=True,
                )
                return
            if parsed.path != "/auth/callback":
                self.respond("Page unavailable", "<p>Use the original sign-in link.</p>", 404)
                return
            try:
                if not self.bound_browser() or len(parsed.query) > 16384:
                    raise ConnectionError("The sign-in browser could not be verified. Start again.")
                values = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=20)
                if any(len(value) != 1 for value in values.values()):
                    raise ConnectionError(
                        "The callback contained repeated parameters. Start again."
                    )
                result = auth.complete(pending, {key: value[0] for key, value in values.items()})
                permitted = bool(result.tokens and PLAN_SCOPE in result.tokens.scopes)
                if permitted:
                    first = not result.welcomed
                    self.respond(
                        "You're using your ChatGPT plan" if first else "ChatGPT reconnected",
                        "<p>Eligible ResearchChain requests use your ChatGPT plan. "
                        "You can close this page and return to ResearchChain.</p>"
                        '<p><a href="https://chatgpt.com/settings/usage">Manage usage</a></p>'
                        '<p><a class="button" href="http://127.0.0.1:3000">Got it</a></p>',
                    )
                    with auth.store.locked():
                        saved = auth.store.read()
                        saved.accounts[result.client_id].welcomed = True
                        auth.store.write(saved)
                else:
                    self.respond(
                        "Signed in; plan use is disabled",
                        "<p>Enable ChatGPT plan usage before running a model. "
                        "Run sign-in again with --consent to request permission.</p>",
                    )
                finished = True
            except (ConnectionError, ValueError) as error:
                failure = (
                    error
                    if isinstance(error, ConnectionError)
                    else ConnectionError("Invalid sign-in callback.")
                )
                self.respond("Sign-in did not complete", f"<p>{html.escape(str(failure))}</p>", 400)
                finished = True

    # Bind first, then construct the exact same callback for authorization/exchange.
    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        server.timeout = 0.5
        origin = f"http://127.0.0.1:{server.server_port}"
        pending = auth.begin(f"{origin}/auth/callback", account_id, new=new, consent=consent)
        url = f"{origin}/start/{entry}"
        announce(
            f"Continue with ChatGPT: {url}"
        )  # Local entry link; contains no OAuth credentials.
        open_browser(url)
        while not finished and time.monotonic() < pending.expires_at:
            server.handle_request()
    if failure:
        raise failure
    if result is None:
        raise ConnectionError("ChatGPT sign-in timed out. Start again when ready.")
    return result
