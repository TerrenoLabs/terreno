import {Announcement} from "@terreno/announcements";
import {findOneOrNoneFor, logger, type SeedContext} from "@terreno/api";
import {DateTime} from "luxon";

/** Stable title for the legacy welcome announcement archived on seed when present. */
export const LEGACY_WELCOME_ANNOUNCEMENT_TITLE = "Welcome to Terreno announcements";

/**
 * Example announcements are seeded as drafts so fresh databases (local dev, every PR preview)
 * do not interrupt sign-in. Admins can publish them from the announcements screen. Release
 * notes reach users through the what's new banner instead.
 */
const SEEDED_ANNOUNCEMENT_STATUS = "draft";

/** Stable title for the staff-only required modal seeded in the example app. */
export const STAFF_MODAL_ANNOUNCEMENT_TITLE = "Example staff operations bulletin";

/** Stable title for the patient-only dismiss-only banner seeded in the example app. */
export const PATIENT_BANNER_ANNOUNCEMENT_TITLE = "Example patient care tip";

const ANNOUNCEMENTS_DOCS_URL = "https://terreno-docs.netlify.app/docs/reference/announcements";
const ANNOUNCEMENTS_OVERVIEW_IMAGE_URL =
  "https://raw.githubusercontent.com/TerrenoLabs/terreno/939dd503/website/static/img/announcements/admin-overview.png";
const ANNOUNCEMENTS_PLATFORMS_IMAGE_URL =
  "https://raw.githubusercontent.com/TerrenoLabs/terreno/939dd503/website/static/img/announcements/admin-editor-platforms.png";
const ANNOUNCEMENTS_VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const STAFF_MODAL_BODY = `## Announcements are ready

Launch updates for staff and patients from one admin workflow.

### Watch the launch

[Product announcement walkthrough](${ANNOUNCEMENTS_VIDEO_URL})

### See performance at a glance

![Announcement overview with impressions and acknowledgements](${ANNOUNCEMENTS_OVERVIEW_IMAGE_URL})

### Target every surface

![Announcement editor platform selection](${ANNOUNCEMENTS_PLATFORMS_IMAGE_URL})

Use **modal**, **banner**, or **feed** delivery with audience targeting, acknowledgement policy, version gating, and CTA analytics.`;
const PATIENT_BANNER_BODY =
  "## A calmer way to share updates\n\nPatient announcements can stay non-blocking while the app remains fully usable.";

const archiveLegacyWelcomeAnnouncement = async (): Promise<void> => {
  const existing = await findOneOrNoneFor(Announcement, {
    title: LEGACY_WELCOME_ANNOUNCEMENT_TITLE,
  });
  if (!existing) {
    return;
  }
  if (existing.status === "archived") {
    logger.info("Skipping announcement seed — legacy welcome already archived");
    return;
  }

  existing.status = "archived";
  existing.archivedAt = DateTime.utc().toJSDate();
  await existing.save();
  logger.info("Archived legacy welcome announcement");
};

const seedStaffModalAnnouncement = async (): Promise<void> => {
  const existing = await findOneOrNoneFor(Announcement, {
    title: STAFF_MODAL_ANNOUNCEMENT_TITLE,
  });
  if (existing) {
    existing.acknowledgementPolicy = "required";
    existing.audienceType = "staff";
    existing.body = STAFF_MODAL_BODY;
    existing.displayMode = "modal";
    existing.primaryAction = {label: "Read the announcement docs", url: ANNOUNCEMENTS_DOCS_URL};
    existing.status = SEEDED_ANNOUNCEMENT_STATUS;
    await existing.save();
    logger.info("Updated staff announcement launch example");
    return;
  }

  await Announcement.create({
    acknowledgementPolicy: "required",
    audienceType: "staff",
    body: STAFF_MODAL_BODY,
    displayMode: "modal",
    primaryAction: {label: "Read the announcement docs", url: ANNOUNCEMENTS_DOCS_URL},
    priority: 20,
    status: SEEDED_ANNOUNCEMENT_STATUS,
    title: STAFF_MODAL_ANNOUNCEMENT_TITLE,
    version: 1,
  });

  logger.info("Seeded staff modal announcement draft");
};

const seedPatientBannerAnnouncement = async (): Promise<void> => {
  const existing = await findOneOrNoneFor(Announcement, {
    title: PATIENT_BANNER_ANNOUNCEMENT_TITLE,
  });
  if (existing) {
    existing.acknowledgementPolicy = "dismiss-only";
    existing.audienceType = "patient";
    existing.body = PATIENT_BANNER_BODY;
    existing.displayMode = "banner";
    existing.status = SEEDED_ANNOUNCEMENT_STATUS;
    await existing.save();
    logger.info("Updated patient announcement launch example");
    return;
  }

  await Announcement.create({
    acknowledgementPolicy: "dismiss-only",
    audienceType: "patient",
    body: PATIENT_BANNER_BODY,
    displayMode: "banner",
    priority: 5,
    status: SEEDED_ANNOUNCEMENT_STATUS,
    title: PATIENT_BANNER_ANNOUNCEMENT_TITLE,
    version: 1,
  });

  logger.info("Seeded patient banner announcement draft");
};

export const seedAnnouncements = async (_context: SeedContext): Promise<void> => {
  await archiveLegacyWelcomeAnnouncement();
  await seedStaffModalAnnouncement();
  await seedPatientBannerAnnouncement();
};
