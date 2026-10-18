import type {PermissionMethod} from "@terreno/api";
import type {Model, Types} from "mongoose";

export type AnnouncementStatus = "draft" | "published" | "archived";
export type AnnouncementPlatform = "ios" | "android" | "web";
export type AnnouncementDisplayMode = "modal" | "banner" | "feed";
export type AnnouncementAudienceType = "staff" | "patient" | "all";
export type AcknowledgementPolicy = "required" | "dismiss-only";

export interface AnnouncementPrimaryAction {
  label: string;
  url: string;
}

export interface AnnouncementRelease {
  buildNumber?: number;
  channel: string;
  product: string;
  version: string;
}

export interface AnnouncementDocument {
  _id: Types.ObjectId;
  deleted: boolean;
  title: string;
  body: string;
  status: AnnouncementStatus;
  version: number;
  priority: number;
  acknowledgementPolicy?: AcknowledgementPolicy;
  audience: unknown;
  audienceType?: AnnouncementAudienceType;
  displayMode?: AnnouncementDisplayMode;
  minBuildNumber?: number;
  publishAt?: Date;
  expiresAt?: Date;
  platforms: AnnouncementPlatform[];
  primaryAction?: AnnouncementPrimaryAction;
  release?: AnnouncementRelease;
  releaseSlug?: string;
  publishedAt?: Date;
  archivedAt?: Date;
  created: Date;
  updated: Date;
}

export type AnnouncementModel = Model<AnnouncementDocument>;

export interface AnnouncementAcknowledgementDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  announcementId: Types.ObjectId;
  version: number;
  acknowledgedAt: Date;
  created: Date;
  updated: Date;
}

export type AnnouncementAcknowledgementModel = Model<AnnouncementAcknowledgementDocument>;

export interface AnnouncementImpressionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  announcementId: Types.ObjectId;
  version: number;
  viewedAt: Date;
  platform?: AnnouncementPlatform;
  created: Date;
  updated: Date;
}

export type AnnouncementImpressionModel = Model<AnnouncementImpressionDocument>;

export type AnnouncementClickAction = "primaryAction";

export interface AnnouncementClickEventDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  announcementId: Types.ObjectId;
  version: number;
  action: AnnouncementClickAction;
  clickedAt: Date;
  platform?: AnnouncementPlatform;
  created: Date;
  updated: Date;
}

export type AnnouncementClickEventModel = Model<AnnouncementClickEventDocument>;

export interface AnnouncementPublic {
  id: string;
  title: string;
  body: string;
  version: number;
  priority: number;
  displayMode: AnnouncementDisplayMode;
  requiresAcknowledgement: boolean;
  primaryAction?: AnnouncementPrimaryAction;
  publishedAt?: string;
}

export type MatchAudienceFunction = (
  user: unknown,
  announcement: AnnouncementDocument
) => boolean | Promise<boolean>;

export interface AnnouncementsHelpOptions {
  /** When true, registers GET /announcements/help/search and GET /announcements/help/:id for MCP and in-app help. */
  enabled?: boolean;
}

export interface AnnouncementsOptions {
  /** Permission methods for the aggregate admin overview. Defaults to IsAdmin. */
  adminOverviewPermissions?: PermissionMethod<AnnouncementDocument>[];
  basePath?: string;
  defaultAcknowledgementPolicy?: AcknowledgementPolicy;
  help?: AnnouncementsHelpOptions;
  /** When omitted, staff targeting uses `user.admin === true`. */
  isStaff?: (user: unknown) => boolean;
  matchAudience?: MatchAudienceFunction;
  /** Dedicated bearer token accepted by POST /announcements/import-release. */
  uploadToken?: string;
  permissions?: Partial<{
    create: PermissionMethod<AnnouncementDocument>[];
    delete: PermissionMethod<AnnouncementDocument>[];
    list: PermissionMethod<AnnouncementDocument>[];
    read: PermissionMethod<AnnouncementDocument>[];
    update: PermissionMethod<AnnouncementDocument>[];
  }>;
}

export interface AnnouncementOverviewMetrics {
  impressions: number;
  acknowledgements: number;
  clicks: number;
}

export interface AnnouncementOverviewRow {
  _id: string;
  title: string;
  status: AnnouncementStatus;
  displayMode: AnnouncementDisplayMode;
  audienceType: AnnouncementAudienceType;
  acknowledgementPolicy: AcknowledgementPolicy;
  priority: number;
  version: number;
  publishedAt?: string;
  expiresAt?: string;
  metrics: AnnouncementOverviewMetrics;
}

export interface AnnouncementOverviewTotals {
  announcements: number;
  published: number;
  draft: number;
  archived: number;
  impressions: number;
  acknowledgements: number;
  clicks: number;
}

export interface AnnouncementOverviewResponse {
  data: AnnouncementOverviewRow[];
  totals: AnnouncementOverviewTotals;
  page: number;
  limit: number;
  total: number;
  more: boolean;
}
