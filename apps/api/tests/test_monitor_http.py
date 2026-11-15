"""Synthetic HTTP streams and a real local TLS receiver exercise notification boundaries."""

import asyncio
import ipaddress
import json
import logging
import ssl
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from pydantic import SecretStr
from test_monitor_state import CANARY, NOW, settings

from researchchain.monitor_http import MonitorHTTP, retry_seconds
from researchchain.monitor_models import AlertEvent, Condition


def event():
    config = settings(
        webhook=SecretStr("https://example.invalid/" + CANARY), bearer=SecretStr(CANARY)
    )
    alert = AlertEvent(
        monitor_id=config.id,
        created_at=NOW,
        observed_at=NOW,
        kind="problem",
        active=[Condition.WORKERS_MISSING],
    )
    return config, alert


class Bytes(httpx.AsyncByteStream):
    def __init__(self, data):
        self.data = data
        self.closed = False
        self.reads = 0

    async def __aiter__(self):
        for index in range(0, len(self.data), 1024):
            self.reads += 1
            yield self.data[index : index + 1024]

    async def aclose(self):
        self.closed = True


def test_health_uses_fixed_path_and_bounds_raw_body() -> None:
    requests = []
    stream = Bytes(b'{"status":"ok"}')

    def handle(request):
        requests.append(request)
        return httpx.Response(200, stream=stream)

    client = MonitorHTTP(transport=httpx.MockTransport(handle))
    assert client.ready("http://127.0.0.1:3000")
    assert requests[0].url.path == "/api/health"
    assert "authorization" not in requests[0].headers
    assert stream.closed
    stream = Bytes(b"x" * 100000)
    assert not client.ready("http://127.0.0.1:3000")
    assert stream.closed and stream.reads <= 5


def test_webhook_payload_identity_headers_and_logs_are_safe(caplog) -> None:
    config, alert = event()
    requests = []
    body = Bytes(b"x" * 100000)
    caplog.set_level(logging.DEBUG)

    def handle(request):
        requests.append(request)
        logging.getLogger("httpcore.synthetic").debug(CANARY)
        return httpx.Response(204, stream=body)

    result = MonitorHTTP(transport=httpx.MockTransport(handle)).send(config, alert)
    assert result.accepted and body.reads == 0 and body.closed
    request = requests[0]
    assert request.headers["Idempotency-Key"] == str(alert.id)
    assert request.headers["Authorization"] == "Bearer " + CANARY
    payload = json.loads(request.content)
    assert set(payload) == {
        "version",
        "id",
        "monitor_id",
        "created_at",
        "observed_at",
        "kind",
        "active",
    }
    assert payload["active"] == ["workers_missing"]
    assert CANARY not in request.content.decode()
    assert CANARY not in caplog.text


@pytest.mark.parametrize("status", [302, 307, 401, 429, 503])
def test_redirects_and_errors_never_follow_or_acknowledge(status) -> None:
    config, alert = event()
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            status,
            headers={"Location": "https://different.invalid/" + CANARY, "Retry-After": "120"},
        )

    client = MonitorHTTP(transport=httpx.MockTransport(handle))
    result = client.send(config, alert)
    assert not result.accepted and result.retry_seconds == 120
    assert len(requests) == 1


def test_total_http_deadline_and_redacted_transport_failure(monkeypatch, caplog) -> None:
    config, alert = event()
    monkeypatch.setattr("researchchain.monitor_http.DEADLINE_SECONDS", 0.02)
    cancelled = []

    async def slow(request):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    client = MonitorHTTP(transport=httpx.MockTransport(slow))
    assert not client.send(config, alert).accepted
    assert cancelled == [True]

    def fail(request):
        raise httpx.ConnectError(CANARY, request=request)

    client = MonitorHTTP(transport=httpx.MockTransport(fail))
    assert not client.send(config, alert).accepted
    assert not client.ready("https://example.invalid")
    assert CANARY not in caplog.text


def test_retry_after_dates_and_limits() -> None:
    assert retry_seconds("999999999999", NOW) == 3600
    assert retry_seconds("120", NOW) == 120
    assert retry_seconds("Thu, 01 Jan 2026 00:02:00 GMT", NOW) == 120
    assert retry_seconds("Thu, 01 Jan 2026 00:00:00 GMT", NOW) == 0
    assert retry_seconds("private-invalid-value", NOW) is None
    assert retry_seconds("9" * 65, NOW) is None


@pytest.fixture
def tls_receiver(tmp_path):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic monitor test")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    certificate, secret = tmp_path / "cert.pem", tmp_path / "key.pem"
    certificate.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    secret.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    received = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self):
            size = int(self.headers["Content-Length"])
            assert size <= 16384
            received.append((dict(self.headers), self.rfile.read(size)))
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, secret)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"https://127.0.0.1:{server.server_port}/synthetic", certificate, received
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()


def test_real_tls_rejects_untrusted_certificate_and_ignores_proxy_environment(
    tls_receiver, monkeypatch
) -> None:
    url, certificate, received = tls_receiver
    config, alert = event()
    config = config.model_copy(update={"webhook": SecretStr(url)})
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("SSL_CERT_FILE", str(certificate))
    assert not MonitorHTTP().send(config, alert).accepted
    assert received == []
    trusted = ssl.create_default_context(cafile=str(certificate))
    assert MonitorHTTP(certificate_context=trusted).send(config, alert).accepted
    assert len(received) == 1
    assert json.loads(received[0][1])["id"] == str(alert.id)
