> **useTerrenoChat**(`options?`): `UseChatHelpers`\<`UIMessage`\<`unknown`, `UIDataTypes`, `UITools`\>\>

Hook that wraps @ai-sdk/react's useChat() pre-configured for a Terreno MCP backend.
Automatically injects Bearer token from auth state.

The backend needs a chat endpoint (e.g. POST /api/chat) that accepts messages
and returns a streaming response. The MCP tools are available server-side via
`getMCPTools()` from `@terreno/ai`.

## Parameters

### options?

[`UseTerrenoChatOptions`](../interfaces/UseTerrenoChatOptions.md) = `{}`

## Returns

`UseChatHelpers`\<`UIMessage`\<`unknown`, `UIDataTypes`, `UITools`\>\>
