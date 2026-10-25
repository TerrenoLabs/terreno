/**
 * Messages for the `?error=` a failed social sign-in returns to the login page with: the
 * server's handoff start sends `provider_not_found` or `sign_in_failed`, and Better Auth's
 * callback sends its own codes, which get the generic message. The code itself is never shown,
 * so a crafted link cannot put its own text on the page.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  provider_not_found: "That sign-in provider is not available.",
  sign_in_failed: "Sign in failed. Please try again.",
};

export const getOAuthErrorMessage = (error: string | string[] | undefined): string | undefined => {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) {
    return undefined;
  }
  return OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.sign_in_failed;
};
