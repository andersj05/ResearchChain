"""Use the real worker and follow asynchronous receipts in API regression tests."""

import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event
from typing import Any

import httpx

from researchchain.runtime import RunStore
from researchchain.worker import RunWorker


@contextmanager
def running_worker(runs: RunStore) -> Iterator[None]:
    stop = Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        worker = executor.submit(RunWorker(runs).serve, stop, 0.05)
        try:
            yield
        finally:
            stop.set()
            worker.result(timeout=15)


def run_request(client: httpx.Client, path: str, **kwargs: Any) -> httpx.Response:
    """Return the final GET response, or the original rejected admission response."""
    response = client.post(path, **kwargs)
    if response.status_code != 202:
        return response
    receipt = response.json()
    assert set(receipt) == {"command_id", "run_id", "kind", "accepted_at"}
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        snapshot = client.get(f"/api/runs/{receipt['run_id']}")
        assert snapshot.status_code == 200, snapshot.text
        if snapshot.json()["status"] not in {"queued", "running"}:
            return snapshot
        time.sleep(0.02)
    raise AssertionError("Accepted synthetic command did not finish within 15 seconds.")
