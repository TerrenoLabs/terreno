/**
 * `GET {routePath}/:id` for one admin model document. The id is a path segment, so it is
 * `encodeURIComponent`-encoded: an id holding `/`, `?` or `#` cannot change the route. Server
 * renders build read URLs with the same function, so their seeds match the hook's request.
 */
export const buildAdminReadUrl = (routePath: string, id: string): string => {
  return `${routePath}/${encodeURIComponent(id)}`;
};
