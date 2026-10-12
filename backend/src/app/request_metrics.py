"""Measure completed requests without buffering response bodies."""

import logging
from time import monotonic

logger = logging.getLogger(__name__)


class RequestMetrics:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started, size, status = monotonic(), 0, 500

        async def measured_send(message):
            nonlocal size, status
            if message["type"] == "http.response.start":
                status = message["status"]
            elif message["type"] == "http.response.body":
                size += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive, measured_send)
        finally:
            route = scope.get("route")
            logger.info(
                "api_request method=%s route=%s status=%s response_bytes=%s duration_seconds=%.3f",
                scope["method"],
                getattr(route, "path", scope["path"]),
                status,
                size,
                monotonic() - started,
            )
