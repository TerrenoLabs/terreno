const KNOWN_TRANSPORTS = new Set(["polling", "websocket"]);

/**
 * Parses `extra.SOCKET_TRANSPORTS` (comma-separated). Undefined keeps the clients' polling-
 * then-websocket default; the Vercel build sets `websocket` because Vercel Functions do not
 * route a session's polling requests back to the instance that holds it.
 */
export const parseSocketTransports = (value: unknown): string[] | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const transports = value
    .split(",")
    .map((transport) => transport.trim())
    .filter((transport) => KNOWN_TRANSPORTS.has(transport));
  return transports.length > 0 ? transports : undefined;
};
