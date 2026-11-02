import {beforeEach, describe, it} from "bun:test";
import {createHash} from "node:crypto";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {McpServiceToken} from "./mcpServiceToken";

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

describe("McpServiceToken", () => {
  beforeEach(async () => {
    await McpServiceToken.deleteMany({});
    await McpServiceToken.syncIndexes();
  });

  it("issues an mcp_ token and stores only its SHA-256 hash", async () => {
    const userId = new mongoose.Types.ObjectId();
    const issued = await McpServiceToken.issueFor({_id: userId}, {name: "Perplexity"});

    assert.match(issued.token, /^mcp_[0-9a-f]{64}$/);
    assert.equal(issued.mcpServiceToken.name, "Perplexity");
    assert.equal(issued.mcpServiceToken.tokenHash, hashToken(issued.token));
    assert.equal(issued.mcpServiceToken.tokenPrefix, issued.token.slice(4, 12));
    assert.notInclude(JSON.stringify(issued.mcpServiceToken.toJSON()), issued.token);
  });

  it("verifies an active token but not a revoked or expired token", async () => {
    const userId = new mongoose.Types.ObjectId();
    const active = await McpServiceToken.issueFor({_id: userId}, {name: "Active"});
    const revoked = await McpServiceToken.issueFor({_id: userId}, {name: "Revoked"});
    const expired = await McpServiceToken.issueFor(
      {_id: userId},
      {expiresAt: DateTime.now().minus({minute: 1}).toJSDate(), name: "Expired"}
    );

    const revokedToken = await McpServiceToken.revokeForUser(
      {_id: userId},
      revoked.mcpServiceToken._id
    );

    assert.equal(
      (await McpServiceToken.verify(active.token))?._id.toString(),
      active.mcpServiceToken._id.toString()
    );
    assert.isDefined(revokedToken?.revokedAt);
    assert.isNull(await McpServiceToken.verify(revoked.token));
    assert.isNull(await McpServiceToken.verify(expired.token));
    assert.isNull(await McpServiceToken.verify("mcp_unknown"));
  });

  it("allows only the owner to revoke an active token once", async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const issued = await McpServiceToken.issueFor({_id: ownerId}, {name: "Owner token"});

    assert.isNull(
      await McpServiceToken.revokeForUser({_id: otherUserId}, issued.mcpServiceToken._id)
    );

    const revoked = await McpServiceToken.revokeForUser({_id: ownerId}, issued.mcpServiceToken._id);
    assert.equal(revoked?._id.toString(), issued.mcpServiceToken._id.toString());
    assert.instanceOf(revoked?.revokedAt, Date);

    assert.isNull(await McpServiceToken.revokeForUser({_id: ownerId}, issued.mcpServiceToken._id));
    assert.isNull(
      await McpServiceToken.revokeForUser({_id: ownerId}, new mongoose.Types.ObjectId())
    );
  });

  it("enforces unique token hashes", async () => {
    const tokenHash = "same-hash";
    const tokenFields = {
      name: "Duplicate",
      tokenHash,
      tokenPrefix: "duplicate",
      userId: new mongoose.Types.ObjectId(),
    };

    await McpServiceToken.create(tokenFields);

    let error: unknown;
    try {
      await McpServiceToken.create(tokenFields);
    } catch (caughtError) {
      error = caughtError;
    }

    assert.instanceOf(error, Error);
    assert.match(error.message, /duplicate key/i);
  });

  it("counts only active tokens for a user", async () => {
    const userId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const revoked = await McpServiceToken.issueFor({_id: userId}, {name: "Revoked"});
    await McpServiceToken.issueFor({_id: userId}, {name: "Active"});
    await McpServiceToken.issueFor(
      {_id: userId},
      {expiresAt: DateTime.now().minus({minute: 1}).toJSDate(), name: "Expired"}
    );
    await McpServiceToken.issueFor({_id: otherUserId}, {name: "Other"});
    await McpServiceToken.revokeForUser({_id: userId}, revoked.mcpServiceToken._id);

    assert.equal(await McpServiceToken.countActiveForUser(userId), 1);
  });

  it("revokes on document deleteOne instead of removing the row", async () => {
    const userId = new mongoose.Types.ObjectId();
    const issued = await McpServiceToken.issueFor({_id: userId}, {name: "Admin delete"});

    await issued.mcpServiceToken.deleteOne();

    const stored = await McpServiceToken.findById(issued.mcpServiceToken._id);
    assert.isDefined(stored?.revokedAt);
    assert.isNull(await McpServiceToken.verify(issued.token));
  });

  it("revokes on query deleteOne used by admin DELETE", async () => {
    const userId = new mongoose.Types.ObjectId();
    const issued = await McpServiceToken.issueFor({_id: userId}, {name: "Query delete"});

    await McpServiceToken.deleteOne({_id: issued.mcpServiceToken._id});

    const stored = await McpServiceToken.findById(issued.mcpServiceToken._id);
    assert.isDefined(stored?.revokedAt);
    assert.isNull(await McpServiceToken.verify(issued.token));
  });
});

describe("McpServiceToken.revokeAllForUser", () => {
  beforeEach(async () => {
    await McpServiceToken.deleteMany({});
  });

  it("revokes only that user's active tokens", async () => {
    const userId = new mongoose.Types.ObjectId();
    const otherId = new mongoose.Types.ObjectId();
    await McpServiceToken.issueFor({_id: userId}, {name: "A"});
    await McpServiceToken.issueFor({_id: userId}, {name: "B"});
    await McpServiceToken.issueFor({_id: otherId}, {name: "Other"});

    const revoked = await McpServiceToken.revokeAllForUser(userId);

    assert.equal(revoked, 2);
    assert.equal(await McpServiceToken.countDocuments({revokedAt: {$exists: false}, userId}), 0);
    assert.equal(
      await McpServiceToken.countDocuments({revokedAt: {$exists: false}, userId: otherId}),
      1
    );
  });
});
