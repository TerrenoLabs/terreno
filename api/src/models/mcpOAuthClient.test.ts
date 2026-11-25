import {beforeEach, describe, expect, it} from "bun:test";

import {McpOAuthClient} from "./mcpOAuthClient";

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const document = {
  clientId: CLIENT_ID,
  clientName: "Claude",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
};

describe("McpOAuthClient.upsertFromMetadataDocument", () => {
  beforeEach(async () => {
    await McpOAuthClient.deleteMany({});
    await McpOAuthClient.init();
  });

  it("returns the live client to every concurrent first-time upsert", async () => {
    const results = await Promise.all(
      Array.from({length: 12}, () => McpOAuthClient.upsertFromMetadataDocument(document))
    );

    expect(results.every((client) => client?.clientId === CLIENT_ID)).toBe(true);
    expect(results.every((client) => client?.revokedAt === undefined)).toBe(true);
    expect(await McpOAuthClient.countDocuments({clientId: CLIENT_ID})).toBe(1);
  });

  it("returns null for a revoked client and leaves it revoked", async () => {
    await McpOAuthClient.upsertFromMetadataDocument(document);
    await McpOAuthClient.revoke(CLIENT_ID);

    const again = await McpOAuthClient.upsertFromMetadataDocument(document);

    expect(again).toBeNull();
    const stored = await McpOAuthClient.findOneOrNone({clientId: CLIENT_ID});
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it("refreshes the stored redirect URIs and name from a later document", async () => {
    await McpOAuthClient.upsertFromMetadataDocument(document);

    const updated = await McpOAuthClient.upsertFromMetadataDocument({
      clientId: CLIENT_ID,
      redirectUris: ["https://claude.ai/api/mcp/auth_callback_v2"],
    });

    expect(updated?.redirectUris).toEqual(["https://claude.ai/api/mcp/auth_callback_v2"]);
    expect(updated?.clientName).toBeUndefined();
    expect(updated?.tokenEndpointAuthMethod).toBe("none");
  });
});
