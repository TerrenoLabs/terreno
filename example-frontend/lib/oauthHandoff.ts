/**
 * Finishes a bearer-mode social sign-in as the app starts.
 *
 * The sign-in returns to /login with a one-time token in the URL fragment. index.js imports
 * lib/oauthHandoffUrl.ts first, which hides the handoff from Expo Router's copy of the URL, then
 * this module, before `expo-router/entry`. Here the held URL goes back and
 * `completeBetterAuthOAuthHandoff` strips it again in the same synchronous step, before any
 * screen reads query parameters. app/_layout.tsx syncs the session only after the exchange
 * settles. Nothing in this app starts Sentry or analytics; anything that does must start after
 * it too.
 */
import {completeOAuthHandoff} from "./betterAuth";
import {restoreHeldOAuthHandoffUrl} from "./oauthHandoffUrl";

restoreHeldOAuthHandoffUrl();

/** Resolves `true` when a returned one-time token was exchanged for a stored bearer. */
export const oauthHandoff: Promise<boolean> = completeOAuthHandoff();
