"""Owner-protected local ChatGPT sign-in controls."""

from uuid import UUID

from fastapi import APIRouter, HTTPException

from researchchain.provider_signin import SignInError, SignInService, SignInStatus


def signin_router(service: SignInService) -> APIRouter:
    router = APIRouter(prefix="/api/providers/chatgpt/sign-in", tags=["ChatGPT connection"])

    @router.get("", response_model=SignInStatus, operation_id="chatgpt_signin_status")
    def status() -> SignInStatus:
        return service.status()

    @router.post("", response_model=SignInStatus, operation_id="start_chatgpt_signin")
    def start() -> SignInStatus:
        try:
            return service.start()
        except SignInError as error:
            raise HTTPException(error.status, str(error)) from None

    @router.post(
        "/{attempt}/cancel", response_model=SignInStatus, operation_id="cancel_chatgpt_signin"
    )
    def cancel(attempt: UUID) -> SignInStatus:
        try:
            return service.cancel(attempt)
        except SignInError as error:
            raise HTTPException(error.status, str(error)) from None

    return router
