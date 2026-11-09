import mongoose from "mongoose";

import {APIError, ConflictError} from "../errors";
import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "../plugins";
import type {MembershipDocument, MembershipModel} from "../types/membership";
import type {OrganizationDocument, OrganizationModel} from "../types/organization";
import {applyOrganizationSettings} from "./organizationSettings";

export type {
  MembershipDocument,
  MembershipMethods,
  MembershipModel,
  MembershipRoleName,
  MembershipSchema,
  MembershipStatics,
  MembershipStatus,
} from "../types/membership";
export type {
  OrganizationDocument,
  OrganizationMethods,
  OrganizationModel,
  OrganizationSchema,
  OrganizationSettings,
  OrganizationStatics,
} from "../types/organization";

const MEMBERSHIP_ROLE_NAMES = ["org-admin", "member"] as const;
const MEMBERSHIP_STATUSES = ["active", "suspended"] as const;

const toObjectId = (value: mongoose.Types.ObjectId | string): mongoose.Types.ObjectId => {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  return new mongoose.Types.ObjectId(value);
};

export const assertOrganizationSlugAvailable = async (
  slug: string,
  excludeOrganizationId?: mongoose.Types.ObjectId
): Promise<void> => {
  const query: {
    _id?: {$ne: mongoose.Types.ObjectId};
    deleted: {$in: boolean[]};
    slug: string;
  } = {deleted: {$in: [true, false]}, slug};
  if (excludeOrganizationId) {
    query._id = {$ne: excludeOrganizationId};
  }
  const existing = await Organization.findOneOrNone(query);
  if (existing) {
    throw new ConflictError("Organization name already in use");
  }
};

export const organizationSlugFromName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new APIError({
      status: 400,
      title: "Organization name must produce a slug",
    });
  }
  return slug;
};

const organizationSchema = new mongoose.Schema<OrganizationDocument, OrganizationModel>(
  {
    disabled: {
      default: false,
      description: "Whether operators have disabled this organization",
      type: Boolean,
    },
    name: {
      description: "Human-readable organization name",
      required: true,
      trim: true,
      type: String,
    },
    ownerId: {
      description: "User who created the organization; transferable",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    settings: {
      description: "App-defined organization settings object",
      type: mongoose.Schema.Types.Mixed,
    },
    slug: {
      description: "URL-safe unique identifier generated from the organization name",
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

organizationSchema.plugin(createdUpdatedPlugin);
organizationSchema.plugin(isDeletedPlugin);
organizationSchema.plugin(findOneOrNone);
organizationSchema.plugin(findExactlyOne);

organizationSchema.pre("validate", function (this: OrganizationDocument): void {
  if (!this.slug) {
    this.slug = organizationSlugFromName(this.name);
  }
  if (!this.isModified("settings")) {
    return;
  }
  this.settings = applyOrganizationSettings(this.settings);
});

const membershipSchema = new mongoose.Schema<MembershipDocument, MembershipModel>(
  {
    organizationId: {
      description: "Organization this membership belongs to",
      index: true,
      ref: "TerrenoOrganization",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    roleName: {
      default: "member",
      description: "Per-organization role: org-admin or member",
      enum: MEMBERSHIP_ROLE_NAMES,
      required: true,
      type: String,
    },
    status: {
      default: "active",
      description: "Whether this membership is active or suspended",
      enum: MEMBERSHIP_STATUSES,
      required: true,
      type: String,
    },
    userId: {
      description: "User who holds this membership",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

membershipSchema.index({organizationId: 1, userId: 1}, {unique: true});

membershipSchema.plugin(createdUpdatedPlugin);
membershipSchema.plugin(isDeletedPlugin);
membershipSchema.plugin(findOneOrNone);
membershipSchema.plugin(findExactlyOne);

membershipSchema.statics = {
  ...membershipSchema.statics,
  async findActiveForUser(
    this: MembershipModel,
    userId: mongoose.Types.ObjectId | string
  ): Promise<MembershipDocument[]> {
    return this.find({
      status: "active",
      userId: toObjectId(userId),
    });
  },
  async isMember(
    this: MembershipModel,
    userId: mongoose.Types.ObjectId | string,
    organizationId: mongoose.Types.ObjectId | string
  ): Promise<boolean> {
    const membership = await this.findOneOrNone({
      organizationId: toObjectId(organizationId),
      status: "active",
      userId: toObjectId(userId),
    });
    return Boolean(membership);
  },
  async isOrgAdmin(
    this: MembershipModel,
    userId: mongoose.Types.ObjectId | string,
    organizationId: mongoose.Types.ObjectId | string
  ): Promise<boolean> {
    const membership = await this.findOneOrNone({
      organizationId: toObjectId(organizationId),
      roleName: "org-admin",
      status: "active",
      userId: toObjectId(userId),
    });
    return Boolean(membership);
  },
};

export const getOrganizationModel = (): OrganizationModel => {
  const existing = mongoose.models.TerrenoOrganization as OrganizationModel | undefined;
  if (existing) {
    return existing;
  }
  return mongoose.model<OrganizationDocument, OrganizationModel>(
    "TerrenoOrganization",
    organizationSchema,
    "organizations"
  );
};

export const getMembershipModel = (): MembershipModel => {
  const existing = mongoose.models.TerrenoMembership as MembershipModel | undefined;
  if (existing) {
    return existing;
  }
  return mongoose.model<MembershipDocument, MembershipModel>(
    "TerrenoMembership",
    membershipSchema,
    "memberships"
  );
};

const createLazyModel = <T extends mongoose.Model<unknown>>(getModel: () => T): T => {
  const handler: ProxyHandler<object> = {
    apply(_target, thisArg, argArray) {
      return Reflect.apply(
        getModel() as unknown as (...args: unknown[]) => unknown,
        thisArg,
        argArray
      );
    },
    construct(_target, argArray) {
      const Model = getModel() as unknown as new (...args: unknown[]) => object;
      return new Model(...argArray);
    },
    get(_target, prop) {
      const model = getModel();
      const value = Reflect.get(model, prop, model);
      if (typeof value === "function") {
        return value.bind(model);
      }
      return value;
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(getModel());
    },
    has(_target, prop) {
      return prop in getModel();
    },
    set(_target, prop, value) {
      Reflect.set(getModel(), prop, value);
      return true;
    },
  };
  class LazyMongooseModel {}
  return new Proxy(LazyMongooseModel, handler) as unknown as T;
};

/** Lazy so importing `@terreno/api` does not register Organization until first use. */
export const Organization = createLazyModel(getOrganizationModel);

/** Lazy so importing `@terreno/api` does not register Membership until first use. */
export const Membership = createLazyModel(getMembershipModel);
