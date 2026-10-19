import {beforeEach, describe, expect, it, spyOn} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {McpOAuthRevokedFamily} from "./mcpOAuthRevokedFamily";
import {McpOAuthFamilyRevokedError, McpOAuthToken} from "./mcpOAuthToken";

const issueOptions = (familyId?: string) => ({
  accessTokenTtlSeconds: 60,
  clientId: "client-1",
  familyId,
  refreshTokenTtlSeconds: 3 * 24 * 60 * 60,
  userId: new mongoose.Types.ObjectId(),
});

const activePairs = (familyId: string): Promise<number> =>
  McpOAuthToken.countDocuments({familyId, revokedAt: {$exists: false}});

describe("McpOAuthToken family revocation", () => {
  beforeEach(async () => {
    await McpOAuthToken.deleteMany({});
    await McpOAuthRevokedFamily.deleteMany({});
  });

  it("revokes every pair in the family and refuses to issue into it afterwards", async () => {
    const {mcpOAuthToken} = await McpOAuthToken.issue(issueOptions());
    const {familyId} = mcpOAuthToken;

    await McpOAuthToken.revokeFamily(familyId);

    expect(await activePairs(familyId)).toBe(0);
    await expect(McpOAuthToken.issue(issueOptions(familyId))).rejects.toBeInstanceOf(
      McpOAuthFamilyRevokedError
    );
    expect(await activePairs(familyId)).toBe(0);
  });

  it("revokes a pair whose family was revoked while it was being created", async () => {
    const familyId = "family-raced";
    const realCreate = McpOAuthToken.create.bind(McpOAuthToken);
    // The revoke lands after issue's first check but before the pair exists.
    const createSpy = spyOn(McpOAuthToken, "create").mockImplementation((async (
      ...args: Parameters<typeof realCreate>
    ) => {
      await McpOAuthToken.revokeFamily(familyId);
      return realCreate(...args);
    }) as typeof McpOAuthToken.create);
    try {
      await expect(McpOAuthToken.issue(issueOptions(familyId))).rejects.toBeInstanceOf(
        McpOAuthFamilyRevokedError
      );
    } finally {
      createSpy.mockRestore();
    }

    expect(await McpOAuthToken.countDocuments({familyId})).toBe(1);
    expect(await activePairs(familyId)).toBe(0);
  });

  it("keeps the tombstone until the family's last refresh token would have expired", async () => {
    const {mcpOAuthToken} = await McpOAuthToken.issue(issueOptions());

    await McpOAuthToken.revokeFamily(mcpOAuthToken.familyId);
    await McpOAuthToken.revokeFamily(mcpOAuthToken.familyId);

    const tombstone = await McpOAuthRevokedFamily.findExactlyOne({
      familyId: mcpOAuthToken.familyId,
    });
    expect(tombstone.expiresAt.getTime()).toBeGreaterThanOrEqual(
      mcpOAuthToken.refreshExpiresAt.getTime()
    );
  });

  it("keeps a tombstone for at least an hour when the family has no pairs", async () => {
    await McpOAuthToken.revokeFamily("family-without-pairs");

    const tombstone = await McpOAuthRevokedFamily.findExactlyOne({
      familyId: "family-without-pairs",
    });
    expect(DateTime.fromJSDate(tombstone.expiresAt).diffNow("minutes").minutes).toBeGreaterThan(59);
  });
});
