"""Only identified infrastructure interruptions qualify for another attempt."""

from botocore.exceptions import (
    ClientError,
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from sqlalchemy.exc import DBAPIError

from app.domain.optimization import OptimizationLeaseActiveError


def is_transient(error):
    if isinstance(
        error,
        (
            ConnectionError,
            TimeoutError,
            OptimizationLeaseActiveError,
            ConnectionClosedError,
            ConnectTimeoutError,
            EndpointConnectionError,
            ReadTimeoutError,
        ),
    ):
        return True
    if isinstance(error, ClientError):
        code = error.response.get("Error", {}).get("Code", "")
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        return (
            code.startswith("Throttl")
            or code
            in {
                "TooManyRequestsException",
                "RequestThrottled",
                "RequestThrottledException",
                "RequestLimitExceeded",
                "SlowDown",
                "RequestTimeout",
                "RequestTimeoutException",
                "ServiceUnavailable",
                "ServiceUnavailableException",
                "InternalError",
                "InternalFailure",
            }
            or status in (500, 502, 503, 504)
        )
    if isinstance(error, DBAPIError):
        code = getattr(error.orig, "sqlstate", None) or getattr(error.orig, "pgcode", None) or ""
        return (
            error.connection_invalidated
            or code.startswith("08")
            or code in {"40001", "40P01", "53300", "57P01", "57P02", "57P03"}
            or isinstance(error.orig, (ConnectionError, TimeoutError))
            or (
                not code
                and any(
                    fragment in str(error.orig).lower()
                    for fragment in (
                        "connection refused",
                        "connection reset",
                        "connection timed out",
                        "connection timeout expired",
                        "server closed the connection",
                        "connection is closed",
                        "network is unreachable",
                        "no route to host",
                    )
                )
            )
        )
    return False
