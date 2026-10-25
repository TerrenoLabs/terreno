import {describe, it} from "bun:test";
import {Announcement} from "@terreno/announcements";
import {findOneOrNoneFor, runSeeds} from "@terreno/api";
import {assert} from "chai";
import {DateTime} from "luxon";

import {
  LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
  PATIENT_BANNER_ANNOUNCEMENT_TITLE,
  STAFF_MODAL_ANNOUNCEMENT_TITLE,
  seedAnnouncements,
} from "./seed-announcements";

const announcementSeedSteps = [
  {
    name: "announcements",
    run: seedAnnouncements,
  },
];

const runAnnouncementSeedsTwice = async (): Promise<void> => {
  await runSeeds({name: "seed-announcements-test", steps: announcementSeedSteps});
  await runSeeds({name: "seed-announcements-test", steps: announcementSeedSteps});
};

describe("seedAnnouncements", () => {
  it("archives a pre-existing legacy welcome and seeds staff modal and patient banner drafts once", async () => {
    await Announcement.deleteMany({
      title: {
        $in: [
          LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
          STAFF_MODAL_ANNOUNCEMENT_TITLE,
          PATIENT_BANNER_ANNOUNCEMENT_TITLE,
        ],
      },
    });

    await Announcement.create({
      acknowledgementPolicy: "required",
      audienceType: "all",
      body: "Legacy welcome body",
      displayMode: "modal",
      priority: 10,
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
      version: 1,
    });

    await runAnnouncementSeedsTwice();

    const legacyWelcome = await findOneOrNoneFor(Announcement, {
      title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
    });
    const staffModal = await findOneOrNoneFor(Announcement, {
      title: STAFF_MODAL_ANNOUNCEMENT_TITLE,
    });
    const patientBanner = await findOneOrNoneFor(Announcement, {
      title: PATIENT_BANNER_ANNOUNCEMENT_TITLE,
    });

    assert.exists(legacyWelcome);
    assert.exists(staffModal);
    assert.exists(patientBanner);
    if (!legacyWelcome || !staffModal || !patientBanner) {
      assert.fail("Expected seeded announcements to exist");
    }

    assert.equal(legacyWelcome.status, "archived");
    assert.exists(legacyWelcome.archivedAt);
    assert.equal(staffModal.audienceType, "staff");
    assert.equal(staffModal.displayMode, "modal");
    assert.equal(staffModal.acknowledgementPolicy, "required");
    assert.include(staffModal.body, "## Announcements are ready");
    assert.include(staffModal.body, "https://www.youtube.com/watch");
    assert.include(staffModal.body, "/img/announcements/admin-overview.png");
    assert.include(staffModal.body, "/img/announcements/admin-editor-platforms.png");
    assert.equal(staffModal.primaryAction?.label, "Read the announcement docs");
    assert.equal(patientBanner.audienceType, "patient");
    assert.equal(patientBanner.displayMode, "banner");
    assert.equal(patientBanner.acknowledgementPolicy, "dismiss-only");
    assert.equal(staffModal.status, "draft");
    assert.equal(patientBanner.status, "draft");

    assert.equal(await Announcement.countDocuments({title: STAFF_MODAL_ANNOUNCEMENT_TITLE}), 1);
    assert.equal(await Announcement.countDocuments({title: PATIENT_BANNER_ANNOUNCEMENT_TITLE}), 1);
    assert.equal(await Announcement.countDocuments({title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE}), 1);
  });

  it("does not create a legacy welcome row when none exists", async () => {
    await Announcement.deleteMany({title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE});

    await runAnnouncementSeedsTwice();

    const legacyWelcome = await findOneOrNoneFor(Announcement, {
      title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
    });
    const staffModal = await findOneOrNoneFor(Announcement, {
      title: STAFF_MODAL_ANNOUNCEMENT_TITLE,
    });
    const patientBanner = await findOneOrNoneFor(Announcement, {
      title: PATIENT_BANNER_ANNOUNCEMENT_TITLE,
    });

    assert.isNull(legacyWelcome);
    assert.exists(staffModal);
    assert.exists(patientBanner);
    assert.equal(await Announcement.countDocuments({title: STAFF_MODAL_ANNOUNCEMENT_TITLE}), 1);
    assert.equal(await Announcement.countDocuments({title: PATIENT_BANNER_ANNOUNCEMENT_TITLE}), 1);
  });

  it("unpublishes seeded examples left published by an earlier seed", async () => {
    await Announcement.deleteMany({
      title: {$in: [STAFF_MODAL_ANNOUNCEMENT_TITLE, PATIENT_BANNER_ANNOUNCEMENT_TITLE]},
    });
    await Announcement.create({
      acknowledgementPolicy: "required",
      audienceType: "staff",
      body: "Old staff body",
      displayMode: "modal",
      priority: 20,
      publishedAt: DateTime.utc().toJSDate(),
      status: "published",
      title: STAFF_MODAL_ANNOUNCEMENT_TITLE,
      version: 1,
    });

    await runAnnouncementSeedsTwice();

    const published = await Announcement.countDocuments({
      status: "published",
      title: {$in: [STAFF_MODAL_ANNOUNCEMENT_TITLE, PATIENT_BANNER_ANNOUNCEMENT_TITLE]},
    });
    assert.equal(published, 0);
    assert.equal(await Announcement.countDocuments({title: STAFF_MODAL_ANNOUNCEMENT_TITLE}), 1);
  });
});
