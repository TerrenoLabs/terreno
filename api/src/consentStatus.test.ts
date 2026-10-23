import {beforeEach, describe, expect, it} from "bun:test";
import type {HydratedDocument} from "mongoose";
import mongoose from "mongoose";

import {getConsentStatuses} from "./consentStatus";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {setupDb, type User} from "./tests";
import type {ConsentFormDocument} from "./types/consentForm";

describe("getConsentStatuses", () => {
  let admin: HydratedDocument<User>;
  let member: HydratedDocument<User>;
  let form: ConsentFormDocument;

  const respond = async (
    overrides: Partial<Record<string, unknown>> = {}
  ): Promise<mongoose.Types.ObjectId> => {
    const response = await ConsentResponse.create({
      agreed: true,
      agreedAt: new Date("2026-02-01T00:00:00.000Z"),
      consentFormId: form._id,
      formVersionSnapshot: 2,
      locale: "en",
      userId: member._id,
      ...overrides,
    });
    return response._id;
  };

  const signProvisionally = (
    overrides: Partial<Record<string, unknown>> = {}
  ): Promise<mongoose.Types.ObjectId> =>
    respond({
      agreedAt: new Date("2026-01-15T00:00:00.000Z"),
      provisional: true,
      provisionalNote: "Guardian agreed at intake",
      provisionalSignedBy: admin._id,
      ...overrides,
    });

  beforeEach(async () => {
    [admin, member] = await setupDb();
    await Promise.all([ConsentForm.deleteMany({}), ConsentResponse.deleteMany({})]);
    form = await ConsentForm.create({
      active: true,
      content: new Map([["en", "# Treatment consent"]]),
      order: 1,
      slug: "treatment",
      title: "Treatment consent",
      type: "agreement",
      version: 2,
    });
  });

  it("returns pending when there are no responses", async () => {
    const rows = await getConsentStatuses({userId: member._id.toString()});

    expect(rows).toHaveLength(1);
    expect(rows[0].form.title).toBe("Treatment consent");
    expect(rows[0].form.content).toEqual({en: "# Treatment consent"});
    expect(rows[0].status).toBe("pending");
    expect(rows[0].isConsented).toBe(false);
    expect(rows[0].respondedAt).toBeUndefined();
    expect(rows[0].provisional).toBeUndefined();
  });

  it("returns provisional, counted as consented, with the signer and note", async () => {
    const responseId = await signProvisionally();

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("provisional");
    expect(row.isConsented).toBe(true);
    expect(row.respondedAt?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(row.provisional).toEqual({
      note: "Guardian agreed at intake",
      responseId: responseId.toString(),
      signedAt: new Date("2026-01-15T00:00:00.000Z"),
      signedBy: {email: "admin@example.com", id: admin._id.toString(), name: "Admin"},
    });
  });

  it("returns signed when the user agreed themselves", async () => {
    await respond();

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("signed");
    expect(row.isConsented).toBe(true);
    expect(row.respondedAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("returns declined when the user declined", async () => {
    await respond({agreed: false});

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("declined");
    expect(row.isConsented).toBe(false);
  });

  it("returns signed when the user agrees after a provisional signature", async () => {
    await signProvisionally();
    await respond({agreed: true});

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("signed");
    expect(row.isConsented).toBe(true);
    expect(row.provisional?.note).toBe("Guardian agreed at intake");
  });

  it("returns declined when the user declines after a provisional signature", async () => {
    await signProvisionally();
    await respond({agreed: false});

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("declined");
    expect(row.isConsented).toBe(false);
  });

  it("uses the user's latest own response", async () => {
    await respond({agreed: false, agreedAt: new Date("2026-02-01T00:00:00.000Z")});
    await respond({agreed: true, agreedAt: new Date("2026-03-01T00:00:00.000Z")});

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("signed");
    expect(row.respondedAt?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("ignores responses to older form versions", async () => {
    await respond({formVersionSnapshot: 1});
    await signProvisionally({formVersionSnapshot: 1});

    const [row] = await getConsentStatuses({userId: member._id.toString()});

    expect(row.status).toBe("pending");
    expect(row.provisional).toBeUndefined();
  });

  it("ignores inactive forms and other users' responses", async () => {
    await ConsentForm.create({
      active: false,
      content: new Map([["en", "# Old"]]),
      order: 2,
      slug: "retired",
      title: "Retired",
      type: "custom",
      version: 1,
    });
    await respond({userId: admin._id});

    const rows = await getConsentStatuses({userId: member._id.toString()});

    expect(rows.map((row) => row.form.slug)).toEqual(["treatment"]);
    expect(rows[0].status).toBe("pending");
  });

  it("lets the resolver filter forms for the target user", async () => {
    await ConsentForm.create({
      active: true,
      content: new Map([["en", "# Research"]]),
      order: 2,
      slug: "research",
      title: "Research",
      type: "research",
      version: 1,
    });
    const resolvedFor: string[] = [];

    const rows = await getConsentStatuses({
      resolveConsentForms: (user, forms) => {
        resolvedFor.push(String(user.id));
        return forms.filter((candidate) => candidate.slug !== "research");
      },
      userId: member._id.toString(),
    });

    expect(resolvedFor).toEqual([member._id.toString()]);
    expect(rows.map((row) => row.form.slug)).toEqual(["treatment"]);
  });

  it("throws 404 for an unknown user", async () => {
    await expect(
      getConsentStatuses({userId: new mongoose.Types.ObjectId().toString()})
    ).rejects.toMatchObject({status: 404, title: "User not found"});
  });

  it("throws 400 for a malformed user id", async () => {
    await expect(getConsentStatuses({userId: "not-an-id"})).rejects.toMatchObject({
      status: 400,
      title: "userId is invalid",
    });
  });
});
