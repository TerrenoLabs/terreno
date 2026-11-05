> **sendToZoom**(`message`, `options`): `Promise`\<`void`\>

Sends a rich formatted message to a Zoom chat channel via webhook.

## Parameters

### message

Message content with header, body, and optional subheader

#### body

`string`

Body text content

#### header

`string`

Main header text for the message

#### subheader?

`string`

Optional subheader text displayed below the main header

### options

Configuration options

#### channel

`string`

The Zoom channel to post to (defaults to "default")

#### env?

`string`

Optional environment prefix (e.g., "stg", "prod") prepended to header

#### shouldThrow?

`boolean` = `false`

If true, throws an APIError on failure; otherwise logs and continues

## Returns

`Promise`\<`void`\>

## Remarks

Requires ZOOM_CHAT_WEBHOOKS environment variable containing JSON with channel configurations:
```json
{
  "default": {"channel": "webhook_url", "verificationToken": "token"},
  "ops": {"channel": "webhook_url", "verificationToken": "token"}
}
```

Falls back to "default" channel if specified channel not found.
Logs errors to Sentry and logger when webhook is missing or request fails.
Uses Zoom's rich message format (format=full) with structured header and body.
