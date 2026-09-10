import os
import unittest
from unittest.mock import patch

from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.api.v0.auth import EmailPasswordRequest, register
from app.auth import _send_verification_email


class VerificationEmailTests(unittest.TestCase):
    def test_ses_rejection_logs_only_the_error_code_and_raises_runtime_error(self) -> None:
        error = ClientError(
            {
                "Error": {
                    "Code": "MessageRejected",
                    "Message": "Email address is not verified: recipient@example.com",
                }
            },
            "SendEmail",
        )
        environment = {
            "APP_ENV": "production",
            "AUTH_JWT_SECRET": "a" * 32,
            "AUTH_REFRESH_PEPPER": "b" * 32,
            "AWS_DEFAULT_REGION": "eu-central-1",
            "PUBLIC_APP_URL": "https://plantperform.cordulus.dev",
            "SES_FROM_EMAIL": "noreply@cordulus.dev",
        }

        with (
            patch.dict(os.environ, environment, clear=True),
            patch("app.auth.boto3.client") as client,
            self.assertLogs("app.auth", level="ERROR") as logs,
            self.assertRaisesRegex(RuntimeError, "Verification email delivery failed"),
        ):
            client.return_value.send_email.side_effect = error
            _send_verification_email("recipient@example.com", "verification-token")

        log_output = "\n".join(logs.output)
        self.assertIn("code=MessageRejected", log_output)
        self.assertNotIn("recipient@example.com", log_output)
        self.assertNotIn("verification-token", log_output)
        self.assertEqual(
            client.return_value.send_email.call_args.kwargs["FromEmailAddress"],
            "PlantPerform <noreply@cordulus.dev>",
        )

    @patch("app.api.v0.auth.register_user", side_effect=RuntimeError("SES unavailable"))
    def test_register_keeps_ses_failures_generic(self, _register_user) -> None:
        request = EmailPasswordRequest(email="recipient@example.com", password="password")

        with self.assertRaises(HTTPException) as context:
            register(request)

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(context.exception.detail, "Verification email could not be sent")


if __name__ == "__main__":
    unittest.main()
