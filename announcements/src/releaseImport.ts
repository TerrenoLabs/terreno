import {timingSafeEqual} from "node:crypto";
import {APIError, findOneOrNoneFor, z} from "@terreno/api";
import type {Request} from "express";
import {DateTime} from "luxon";
import {Announcement} from "./models/announcement";
import {announcementPlatformSchema, parseAnnouncementBody} from "./requestBodies";
import type {AnnouncementDocument, AnnouncementRelease} from "./types";

const announcementDefaultsSchema = z
  .object({
    acknowledgementPolicy: z.enum(["required", "dismiss-only"]).optional(),
    audience: z.unknown().optional(),
    audienceType: z.enum(["staff", "patient", "all"]).optional(),
    displayMode: z.enum(["modal", "banner", "feed"]).optional(),
    expiresAt: z.string().datetime().optional(),
    minBuildNumber: z.number().int().positive().optional(),
    platforms: z.array(announcementPlatformSchema).min(1).optional(),
    priority: z.number().optional(),
    publishAt: z.string().datetime().optional(),
  })
  .strict();

export const announcementReleaseImportSchema = z
  .object({
    announcements: z
      .array(
        announcementDefaultsSchema.extend({
          body: z.string().min(1),
          primaryAction: z
            .object({
              label: z.string().min(1),
              url: z.string().url(),
            })
            .strict()
            .optional(),
          slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          title: z.string().min(1),
        })
      )
      .min(1)
      .max(100),
    defaults: announcementDefaultsSchema.optional(),
    publish: z.boolean().default(false),
    release: z
      .object({
        buildNumber: z.number().int().positive().optional(),
        channel: z.string().min(1).default("production"),
        product: z.string().min(1),
        version: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const seenSlugs = new Set<string>();
    for (const [index, item] of input.announcements.entries()) {
      if (seenSlugs.has(item.slug)) {
        context.addIssue({
          code: "custom",
          message: "Release announcement slugs must be unique",
          path: ["announcements", index, "slug"],
        });
      }
      seenSlugs.add(item.slug);
    }
  });

type AnnouncementDefaultsInput = z.output<typeof announcementDefaultsSchema>;

export type AnnouncementReleaseImportInput = z.output<typeof announcementReleaseImportSchema>;

export type AnnouncementReleaseItemInput = AnnouncementReleaseImportInput["announcements"][number];

export interface AnnouncementReleaseImportResult {
  created: number;
  published: number;
  unchanged: number;
  updated: number;
  announcements: Array<{
    id: string;
    slug: string;
    status: "draft" | "published" | "archived";
    version: number;
  }>;
}

const safeTokenEquals = ({expected, provided}: {expected: string; provided: string}): boolean => {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
};

const readBearerToken = (req: Request): string | undefined => {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length);
};

export const requireAnnouncementUploadAccess = ({
  req,
  uploadToken,
}: {
  req: Request;
  uploadToken?: string;
}): void => {
  if ((req.user as {admin?: boolean} | undefined)?.admin) {
    return;
  }
  const providedToken = readBearerToken(req);
  if (!uploadToken || !providedToken) {
    throw new APIError({status: 401, title: "Announcement upload authentication required"});
  }
  if (!safeTokenEquals({expected: uploadToken, provided: providedToken})) {
    throw new APIError({status: 401, title: "Invalid announcement upload token"});
  }
};

const parseOptionalDate = (value?: string): Date | undefined => {
  if (!value) {
    return undefined;
  }
  return DateTime.fromISO(value, {setZone: true}).toJSDate();
};

const applyImportedValues = ({
  announcement,
  defaults,
  item,
  publish,
  release,
}: {
  announcement: AnnouncementDocument;
  defaults?: AnnouncementDefaultsInput;
  item: AnnouncementReleaseItemInput;
  publish: boolean;
  release: AnnouncementRelease;
}): void => {
  const merged = {...defaults, ...item};
  announcement.acknowledgementPolicy = merged.acknowledgementPolicy;
  announcement.audience = merged.audience ?? {};
  announcement.audienceType = merged.audienceType ?? "all";
  announcement.body = item.body;
  announcement.displayMode = merged.displayMode ?? "feed";
  announcement.expiresAt = parseOptionalDate(merged.expiresAt);
  announcement.minBuildNumber = merged.minBuildNumber ?? release.buildNumber;
  announcement.platforms = merged.platforms ?? ["ios", "android", "web"];
  announcement.primaryAction = item.primaryAction;
  announcement.priority = merged.priority ?? 0;
  announcement.publishAt = parseOptionalDate(merged.publishAt);
  announcement.release = release;
  announcement.releaseSlug = item.slug;
  announcement.title = item.title;
  if (!publish) {
    return;
  }
  announcement.archivedAt = undefined;
  announcement.publishedAt ??= DateTime.utc().toJSDate();
  announcement.status = "published";
};

const snapshotImportedValues = (announcement: AnnouncementDocument): string =>
  JSON.stringify({
    acknowledgementPolicy: announcement.acknowledgementPolicy,
    archivedAt: announcement.archivedAt,
    audience: announcement.audience,
    audienceType: announcement.audienceType,
    body: announcement.body,
    deleted: announcement.deleted,
    displayMode: announcement.displayMode,
    expiresAt: announcement.expiresAt,
    minBuildNumber: announcement.minBuildNumber,
    platforms: announcement.platforms,
    primaryAction: announcement.primaryAction,
    priority: announcement.priority,
    publishAt: announcement.publishAt,
    publishedAt: announcement.publishedAt,
    release: announcement.release,
    releaseSlug: announcement.releaseSlug,
    status: announcement.status,
    title: announcement.title,
  });

export const importAnnouncementRelease = async ({
  input: rawInput,
}: {
  input: unknown;
}): Promise<AnnouncementReleaseImportResult> => {
  const input = parseAnnouncementBody({body: rawInput, schema: announcementReleaseImportSchema});

  const result: AnnouncementReleaseImportResult = {
    announcements: [],
    created: 0,
    published: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const item of input.announcements) {
    const existing = await findOneOrNoneFor(Announcement, {
      deleted: {$in: [true, false]},
      "release.channel": input.release.channel,
      "release.product": input.release.product,
      "release.version": input.release.version,
      releaseSlug: item.slug,
    });
    const announcement =
      existing ??
      new Announcement({
        audience: {},
        body: item.body,
        priority: 0,
        release: input.release,
        releaseSlug: item.slug,
        status: "draft",
        title: item.title,
        version: 1,
      });
    const wasCreated = announcement.isNew;
    const previousValues = snapshotImportedValues(announcement);

    announcement.deleted = false;
    applyImportedValues({
      announcement,
      defaults: input.defaults,
      item,
      publish: input.publish,
      release: input.release,
    });
    const hasChanges = wasCreated || previousValues !== snapshotImportedValues(announcement);
    if (hasChanges) {
      await announcement.save();
    }

    if (wasCreated) {
      result.created += 1;
    } else if (hasChanges) {
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
    if (input.publish && announcement.status === "published") {
      result.published += 1;
    }
    result.announcements.push({
      id: announcement._id.toString(),
      slug: item.slug,
      status: announcement.status,
      version: announcement.version,
    });
  }

  return result;
};
