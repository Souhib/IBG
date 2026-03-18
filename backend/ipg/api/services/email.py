from loguru import logger
from resend import Emails

from ipg.settings import Settings


class EmailService:
    """Email service using Resend API."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._emails = Emails(api_key=settings.resend_api_key) if settings.resend_api_key else None

    async def send_password_reset_email(self, to_email: str, username: str, reset_url: str) -> bool:
        """Send password reset email."""
        subject = "IPG - Reset Your Password"
        html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #10b981;">IPG - Islamic Party Games</h2>
            <p>Hi {username},</p>
            <p>You requested a password reset. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{reset_url}" style="background-color: #10b981; color: white; padding: 12px 32px;
                   text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                    Reset Password
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
        """
        return await self._send(to_email, subject, html)

    async def send_verification_email(self, to_email: str, username: str, verify_url: str) -> bool:
        """Send email verification."""
        subject = "IPG - Verify Your Email"
        html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #10b981;">IPG - Islamic Party Games</h2>
            <p>Hi {username},</p>
            <p>Welcome to IPG! Please verify your email address:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{verify_url}" style="background-color: #10b981; color: white; padding: 12px 32px;
                   text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                    Verify Email
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
        </div>
        """
        return await self._send(to_email, subject, html)

    async def _send(self, to_email: str, subject: str, html: str) -> bool:
        """Send an email via Resend API."""
        if not self._emails:
            logger.warning("Email service not configured (no RESEND_API_KEY). Skipping email to {to}", to=to_email)
            return False
        try:
            self._emails.send(
                {
                    "from": self.settings.from_email,
                    "to": [to_email],
                    "subject": subject,
                    "html": html,
                }
            )
            logger.debug("Email sent to {to}: {subject}", to=to_email, subject=subject)
            return True
        except Exception:
            logger.exception("Failed to send email to {to}", to=to_email)
            return False
