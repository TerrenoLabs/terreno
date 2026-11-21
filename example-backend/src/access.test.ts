import {describe, it} from "bun:test";
import {assert} from "chai";

import {access, appStatements} from "./access";

describe("example-backend access statements", () => {
  it("declares admin-exposed models so superadmin * can list them", () => {
    assert.includeMembers([...appStatements.featureFlag], ["list", "read"]);
    assert.includeMembers([...appStatements.consentForm], ["list", "read"]);
    assert.includeMembers([...appStatements.consentResponse], ["list", "read"]);
    assert.includeMembers([...appStatements.announcement], ["list", "read", "create"]);
    assert.deepEqual([...appStatements.adminAnnouncement], ["read", "write", "writeOwned"]);
    assert.deepEqual(
      [...appStatements.adminAnnouncementAcknowledgement],
      ["read", "write", "writeOwned"]
    );
    assert.deepEqual(
      [...appStatements.adminAnnouncementClickEvent],
      ["read", "write", "writeOwned"]
    );
    assert.deepEqual(
      [...appStatements.adminAnnouncementImpression],
      ["read", "write", "writeOwned"]
    );
    assert.deepEqual([...appStatements.adminAuditEvent], ["list", "read"]);
    assert.deepEqual([...appStatements.adminAuditLog], ["list", "read"]);
    assert.deepEqual([...appStatements.adminMcpServiceToken], ["read", "write", "writeOwned"]);
    assert.includeMembers([...appStatements.todo], ["list", "read"]);
    assert.deepEqual([...appStatements.adminTodo], ["read", "write", "writeOwned"]);
    assert.deepEqual([...appStatements.adminUser], ["read", "write", "writeOwned"]);
    assert.includeMembers([...appStatements.adminScreen], ["showcase", "syncLab"]);
    assert.includeMembers([...appStatements.admin], ["access", "jobs"]);
  });

  it("gives every grantable permission an optional description", () => {
    for (const [resource, actions] of Object.entries(appStatements)) {
      for (const action of actions) {
        const description = access.statementDescriptions[resource]?.[action];
        assert.isString(description, `${resource}.${action}`);
        assert.isAbove((description ?? "").trim().length, 0, `${resource}.${action}`);
      }
    }
  });
});
