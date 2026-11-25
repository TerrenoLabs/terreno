> **markRetryUnsafe**(`config?`): `AxiosRequestConfig`

Opts a non-idempotent request (POST/PUT/PATCH/DELETE) into the retry policy of a
createAuthenticatedClient instance: `client.axios.post(url, body, markRetryUnsafe())`.
Callers must be sure the operation is safe to repeat, and the request body must be
replayable — JSON objects are fine, but streams/FormData are consumed on first send.
Has no effect on axios instances not created by createAuthenticatedClient.

## Parameters

### config?

`AxiosRequestConfig` = `{}`

## Returns

`AxiosRequestConfig`
