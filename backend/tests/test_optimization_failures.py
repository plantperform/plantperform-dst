import unittest
from types import SimpleNamespace

from botocore.exceptions import ClientError, EndpointConnectionError
from sqlalchemy.exc import DBAPIError

from app.services.optimization.failures import is_transient


class FailureClassificationTests(unittest.TestCase):
    def test_only_known_transient_errors_retry(self):
        for error in (
            ConnectionError(),
            TimeoutError(),
            EndpointConnectionError(endpoint_url="test"),
        ):
            with self.subTest(error=error):
                self.assertTrue(is_transient(error))
        for error in (RuntimeError(), ValueError(), MemoryError(), ImportError(), TypeError()):
            with self.subTest(error=error):
                self.assertFalse(is_transient(error))

    def test_service_throttling_and_unavailability_retry_but_permissions_do_not(self):
        for code, expected in (
            ("ThrottlingException", True),
            ("ServiceUnavailable", True),
            ("AccessDenied", False),
            ("InvalidParameterValue", False),
        ):
            with self.subTest(code=code):
                self.assertEqual(
                    is_transient(ClientError({"Error": {"Code": code}}, "test")), expected
                )

    def test_database_disconnect_deadlock_and_serialization_retry(self):
        for code, expected in (
            ("08006", True),
            ("40001", True),
            ("40P01", True),
            ("53300", True),
            ("23505", False),
            ("42P01", False),
            ("28P01", False),
        ):
            with self.subTest(code=code):
                error = DBAPIError("query", {}, SimpleNamespace(sqlstate=code))
                self.assertEqual(is_transient(error), expected)

    def test_initial_database_connection_failures_are_classified_narrowly(self):
        for message, expected in (
            ("connection refused", True),
            ("server closed the connection unexpectedly", True),
            ("password authentication failed", False),
            ("database does not exist", False),
        ):
            with self.subTest(message=message):
                self.assertEqual(
                    is_transient(DBAPIError("connect", {}, Exception(message))), expected
                )
