/**
 * Type a `fetch` stub as `typeof fetch`. Bun's `fetch` type also declares `preconnect`, which
 * the stub gets as a no-op.
 */
export const fakeFetch = (
  stub: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(stub, {preconnect: (): void => {}});
