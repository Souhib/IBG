"""Tests for ASGI middleware: SecurityMiddleware, RequestIDMiddleware, LoggingMiddleware."""

from unittest.mock import patch
from uuid import UUID

import httpx
import pytest
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from majlisna.api.middleware import LoggingMiddleware, RequestIDMiddleware, SecurityMiddleware

# ─── Helpers ──────────────────────────────────────────────────


async def _ok_app(scope: Scope, receive: Receive, send: Send) -> None:
    """Minimal ASGI app that returns 200 OK."""
    response = PlainTextResponse("ok")
    await response(scope, receive, send)


async def _echo_query_app(scope: Scope, receive: Receive, send: Send) -> None:
    """ASGI app that echoes the query string back in the response body."""
    qs = scope.get("query_string", b"").decode()
    response = PlainTextResponse(qs)
    await response(scope, receive, send)


async def _slow_app(scope: Scope, receive: Receive, send: Send) -> None:
    """ASGI app that takes >1s to respond (simulated via time offset)."""
    response = PlainTextResponse("slow")
    await response(scope, receive, send)


async def _error_app(_scope: Scope, _receive: Receive, _send: Send) -> None:
    """ASGI app that raises an exception."""
    raise RuntimeError("Intentional test error")


async def _status_app(scope: Scope, receive: Receive, send: Send) -> None:
    """ASGI app that returns 201."""
    response = PlainTextResponse("created", status_code=201)
    await response(scope, receive, send)


def _client(app: ASGIApp) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ─── SecurityMiddleware ──────────────────────────────────────


@pytest.mark.asyncio
async def test_security_null_byte_rejected():
    """Null byte in URL path returns 400."""
    # Prepare
    app = SecurityMiddleware(_ok_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/foo%00bar")

    # Assert
    assert response.status_code == 400
    assert response.json()["error"] == "Invalid request"


@pytest.mark.asyncio
async def test_security_overlong_path_rejected():
    """URL path exceeding 2048 chars returns 414."""
    # Prepare
    app = SecurityMiddleware(_ok_app)
    long_path = "/" + "a" * 2100

    # Act
    async with _client(app) as client:
        response = await client.get(long_path)

    # Assert
    assert response.status_code == 414
    assert response.json()["error"] == "URI too long"


@pytest.mark.asyncio
async def test_security_script_tag_stripped():
    """Script tags in query params are removed."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test", params={"q": '<script>alert("xss")</script>hello'})

    # Assert
    assert "<script" not in response.text
    assert "hello" in response.text


@pytest.mark.asyncio
async def test_security_event_handler_stripped():
    """Event handler attributes (onclick=) in query params are removed."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test", params={"q": "onclick=alert(1)"})

    # Assert
    assert "onclick=" not in response.text


@pytest.mark.asyncio
async def test_security_dangerous_protocol_stripped():
    """Dangerous protocols (javascript:) in query params are removed."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test", params={"q": "javascript:alert(1)"})

    # Assert
    assert "javascript:" not in response.text


@pytest.mark.asyncio
async def test_security_path_traversal_stripped():
    """Path traversal sequences (../) in query params are removed."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test", params={"path": "../../etc/passwd"})

    # Assert
    assert "../" not in response.text


@pytest.mark.asyncio
async def test_security_clean_params_pass_through():
    """Normal query params pass through unchanged."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test", params={"q": "hello world", "page": "1"})

    # Assert
    assert "hello" in response.text
    assert "page=1" in response.text


@pytest.mark.asyncio
async def test_security_headers_present():
    """Security headers are added to the response."""
    # Prepare
    app = SecurityMiddleware(_ok_app, is_production=False)

    # Act
    async with _client(app) as client:
        response = await client.get("/test")

    # Assert
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-xss-protection"] == "1; mode=block"
    assert "strict-transport-security" not in response.headers


@pytest.mark.asyncio
async def test_security_hsts_production_only():
    """HSTS header is only present in production mode."""
    # Prepare
    app = SecurityMiddleware(_ok_app, is_production=True)

    # Act
    async with _client(app) as client:
        response = await client.get("/test")

    # Assert
    assert "strict-transport-security" in response.headers
    assert "max-age=31536000" in response.headers["strict-transport-security"]


@pytest.mark.asyncio
async def test_security_non_http_scope_passes_through():
    """Non-HTTP scope types (lifespan) are passed through without processing."""
    # Prepare
    called = False

    async def passthrough_app(_scope: Scope, _receive: Receive, _send: Send) -> None:
        nonlocal called
        called = True

    app = SecurityMiddleware(passthrough_app)

    # Act — simulate lifespan scope
    scope = {"type": "lifespan"}
    await app(scope, lambda: None, lambda _msg: None)

    # Assert
    assert called


@pytest.mark.asyncio
async def test_security_websocket_passes_through():
    """WebSocket scope passes through without security header injection."""
    # Prepare
    called = False

    async def ws_app(_scope: Scope, _receive: Receive, _send: Send) -> None:
        nonlocal called
        called = True

    app = SecurityMiddleware(ws_app)

    # Act — simulate websocket scope
    scope = {"type": "websocket", "path": "/ws"}
    await app(scope, lambda: None, lambda _msg: None)

    # Assert
    assert called


@pytest.mark.asyncio
async def test_security_multiple_attack_vectors():
    """Multiple attack vectors in a single request are all sanitized."""
    # Prepare
    app = SecurityMiddleware(_echo_query_app)

    # Act
    async with _client(app) as client:
        response = await client.get(
            "/test",
            params={"a": "<script>x</script>", "b": "onclick=y", "c": "javascript:z", "d": "../../etc"},
        )

    # Assert
    assert "<script" not in response.text
    assert "onclick=" not in response.text
    assert "javascript:" not in response.text
    assert "../" not in response.text


# ─── RequestIDMiddleware ──────────────────────────────────────


@pytest.mark.asyncio
async def test_request_id_present_in_response():
    """Response contains X-Request-ID header."""
    # Prepare
    app = RequestIDMiddleware(_ok_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test")

    # Assert
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_request_id_is_valid_uuid():
    """X-Request-ID header is a valid UUID."""
    # Prepare
    app = RequestIDMiddleware(_ok_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test")

    # Assert
    request_id = response.headers["x-request-id"]
    UUID(request_id)  # Raises ValueError if invalid


@pytest.mark.asyncio
async def test_request_id_unique_per_request():
    """Each request gets a unique ID."""
    # Prepare
    app = RequestIDMiddleware(_ok_app)

    # Act
    async with _client(app) as client:
        r1 = await client.get("/test")
        r2 = await client.get("/test")

    # Assert
    assert r1.headers["x-request-id"] != r2.headers["x-request-id"]


@pytest.mark.asyncio
async def test_request_id_stored_in_scope_state():
    """Request ID is stored in scope['state'] for downstream access."""
    # Prepare
    captured_id = None

    async def capture_app(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal captured_id
        captured_id = scope.get("state", {}).get("request_id")
        response = PlainTextResponse("ok")
        await response(scope, receive, send)

    app = RequestIDMiddleware(capture_app)

    # Act
    async with _client(app) as client:
        response = await client.get("/test")

    # Assert
    assert captured_id is not None
    assert captured_id == response.headers["x-request-id"]


@pytest.mark.asyncio
async def test_request_id_non_http_passes_through():
    """Non-HTTP scope passes through without adding request ID."""
    # Prepare
    called = False

    async def passthrough_app(_scope: Scope, _receive: Receive, _send: Send) -> None:
        nonlocal called
        called = True

    app = RequestIDMiddleware(passthrough_app)

    # Act
    scope = {"type": "lifespan"}
    await app(scope, lambda: None, lambda _msg: None)

    # Assert
    assert called


# ─── LoggingMiddleware ──────────────────────────────────────


@pytest.mark.asyncio
async def test_logging_request_start_logged():
    """Request start is logged with method and path."""
    # Prepare
    app = LoggingMiddleware(_ok_app)

    # Act
    with patch("majlisna.api.middleware.logger") as mock_logger:
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        async with _client(app) as client:
            await client.get("/test-path")

    # Assert
    start_call = mock_logger.info.call_args_list[0]
    assert "Request started" in start_call.args[0]
    assert start_call.kwargs["method"] == "GET"
    assert start_call.kwargs["path"] == "/test-path"


@pytest.mark.asyncio
async def test_logging_request_completion_logged():
    """Request completion is logged with status code and duration."""
    # Prepare
    app = LoggingMiddleware(_status_app)

    # Act
    with patch("majlisna.api.middleware.logger") as mock_logger:
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        async with _client(app) as client:
            await client.get("/test")

    # Assert
    completion_call = mock_logger.info.call_args_list[1]
    assert "Request completed" in completion_call.args[0]
    assert completion_call.kwargs["status_code"] == 201


@pytest.mark.asyncio
async def test_logging_slow_request_warning():
    """Slow requests (>1s) trigger a warning log."""
    # Prepare
    app = LoggingMiddleware(_ok_app)

    # Act — patch perf_counter to simulate 2s duration
    with (
        patch("majlisna.api.middleware.logger") as mock_logger,
        patch("majlisna.api.middleware.time") as mock_time,
    ):
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        mock_time.perf_counter.side_effect = [0.0, 2.0]  # start=0, end=2 → 2000ms
        async with _client(app) as client:
            await client.get("/test")

    # Assert
    mock_logger.warning.assert_called_once()
    warning_call = mock_logger.warning.call_args
    assert "Slow request" in warning_call.args[0]


@pytest.mark.asyncio
async def test_logging_exception_reraised_and_logged():
    """Exception in downstream app is re-raised and logged as error."""
    # Prepare
    app = LoggingMiddleware(_error_app)

    # Act & Assert
    with (
        patch("majlisna.api.middleware.logger") as mock_logger,
        patch("majlisna.api.middleware.time") as mock_time,
        pytest.raises(RuntimeError, match="Intentional test error"),
    ):
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        mock_time.perf_counter.side_effect = [0.0, 0.1]
        async with _client(app) as client:
            await client.get("/test")

    mock_logger.error.assert_called_once()
    error_call = mock_logger.error.call_args
    assert "Request failed" in error_call.args[0]


@pytest.mark.asyncio
async def test_logging_auth_header_creates_user_prefix():
    """Auth header presence creates [user] prefix in logs."""
    # Prepare
    app = LoggingMiddleware(_ok_app)

    # Act
    with patch("majlisna.api.middleware.logger") as mock_logger:
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        async with _client(app) as client:
            await client.get("/test", headers={"Authorization": "Bearer some-long-token-value"})

    # Assert
    contextualize_call = mock_logger.contextualize.call_args
    assert contextualize_call.kwargs["user_id"] == "[user] "


@pytest.mark.asyncio
async def test_logging_no_auth_header_empty_prefix():
    """No auth header results in empty user_id prefix."""
    # Prepare
    app = LoggingMiddleware(_ok_app)

    # Act
    with patch("majlisna.api.middleware.logger") as mock_logger:
        mock_logger.contextualize.return_value.__enter__ = lambda _s: None
        mock_logger.contextualize.return_value.__exit__ = lambda _s, *_a: None
        async with _client(app) as client:
            await client.get("/test")

    # Assert
    contextualize_call = mock_logger.contextualize.call_args
    assert contextualize_call.kwargs["user_id"] == ""


@pytest.mark.asyncio
async def test_logging_non_http_passes_through():
    """Non-HTTP scope passes through without logging."""
    # Prepare
    called = False

    async def passthrough_app(_scope: Scope, _receive: Receive, _send: Send) -> None:
        nonlocal called
        called = True

    app = LoggingMiddleware(passthrough_app)

    # Act
    with patch("majlisna.api.middleware.logger") as mock_logger:
        scope = {"type": "lifespan"}
        await app(scope, lambda: None, lambda _msg: None)

    # Assert
    assert called
    mock_logger.info.assert_not_called()
