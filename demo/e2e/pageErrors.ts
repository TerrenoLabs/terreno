/**
 * React's recoverable hydration errors: #418 (server HTML did not match), #423 (React recovered
 * by rendering on the client), and #425 (text content did not match). The demo's static export
 * raises #418 on every route because its pre-rendered HTML differs from the first client render,
 * and React then renders on the client, so these leave the page working.
 */
const RECOVERABLE_HYDRATION_ERROR = /^Minified React error #(418|423|425);/;

/** The page errors a smoke should fail on: every one except React's recoverable hydration errors. */
export const unexpectedPageErrors = (messages: string[]): string[] =>
  messages.filter((message) => !RECOVERABLE_HYDRATION_ERROR.test(message));
