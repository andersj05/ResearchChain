"""Synthetic OAuth server fixture for browser tests; never opens external connections."""

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from test_chatgpt_provider import Harness

from researchchain.providers.chatgpt_auth import PendingLogin
from researchchain.providers.chatgpt_login import browser_login

if __name__ == "__main__":
    with TemporaryDirectory(prefix="researchchain-signin-test-") as directory:
        harness = Harness(Path(directory))
        original_begin = harness.auth.begin

        def begin(*args: Any, **kwargs: Any) -> PendingLogin:
            harness.pending = original_begin(*args, **kwargs)
            return harness.pending

        harness.auth.begin = begin
        browser_login(harness.auth, open_browser=lambda url: None)
