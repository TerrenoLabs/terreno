import {afterAll, describe, expect, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {
  Announcement,
  AnnouncementAcknowledgement,
  AnnouncementClickEvent,
  AnnouncementImpression,
  AnnouncementsApp,
  excerptBody,
  isAnnouncementPendingForUser,
  resolveAcknowledgementPolicy,
  toAnnouncementPublic,
} from "../index";

const CONSUMER_MODEL_NAMES = [
  "Announcement",
  "AnnouncementAcknowledgement",
  "AnnouncementClickEvent",
  "AnnouncementImpression",
] as const;

afterAll(() => {
  for (const modelName of CONSUMER_MODEL_NAMES) {
    if (mongoose.models[modelName]) {
      mongoose.deleteModel(modelName);
    }
  }
});

describe("@terreno/announcements package exports", () => {
  it("re-exports the announcements plugin surface", () => {
    expect(typeof AnnouncementsApp).toBe("function");
    expect(Announcement.modelName).toBe("TerrenoAnnouncement");
    expect(excerptBody("hello world")).toBe("hello world");
    expect(
      isAnnouncementPendingForUser({
        acknowledgements: [],
        announcement: {
          _id: "a",
          acknowledgementPolicy: "required",
          body: "Body",
          priority: 1,
          publishedAt: new Date(),
          status: "published",
          title: "Title",
          version: 1,
        } as never,
        impressions: [],
      })
    ).toBe(true);
    const dismissOnly = {
      _id: "a",
      acknowledgementPolicy: "dismiss-only",
      body: "Body",
      priority: 1,
      publishedAt: new Date(),
      status: "published",
      title: "Title",
      version: 1,
    } as never;
    const omittedPolicy = {
      _id: "b",
      body: "Body",
      priority: 1,
      publishedAt: new Date(),
      status: "published",
      title: "Title",
      version: 1,
    } as never;
    expect(toAnnouncementPublic(dismissOnly).id).toBe("a");
    expect(toAnnouncementPublic(dismissOnly).requiresAcknowledgement).toBe(false);
    expect(toAnnouncementPublic(omittedPolicy, "required").requiresAcknowledgement).toBe(true);
    expect(resolveAcknowledgementPolicy({announcement: dismissOnly})).toBe("dismiss-only");
  });

  it("uses namespaced model names while preserving collections", () => {
    const models = [
      [Announcement, "TerrenoAnnouncement", "announcements"],
      [
        AnnouncementAcknowledgement,
        "TerrenoAnnouncementAcknowledgement",
        "announcementacknowledgements",
      ],
      [AnnouncementClickEvent, "TerrenoAnnouncementClickEvent", "announcementclickevents"],
      [AnnouncementImpression, "TerrenoAnnouncementImpression", "announcementimpressions"],
    ] as const;

    for (const [model, modelName, collectionName] of models) {
      assert.equal(model.modelName, modelName);
      assert.equal(model.collection.collectionName, collectionName);
    }
    for (const modelName of CONSUMER_MODEL_NAMES) {
      assert.doesNotThrow(() => mongoose.model(modelName, new mongoose.Schema({})));
    }
  });
});
