import mongoose, {type Schema} from "mongoose";

import {BadRequestError} from "../errors";

export interface OrgScoped {
  organizationId: mongoose.Types.ObjectId;
}

export const ORGANIZATION_ID_IMMUTABLE_TITLE = "organizationId cannot be changed";

const updateContainsOrganizationId = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(updateContainsOrganizationId);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, nestedValue]) => {
    if (key === "organizationId" || key.startsWith("organizationId.")) {
      return true;
    }
    if (key === "$rename" && nestedValue && typeof nestedValue === "object") {
      return Object.entries(nestedValue).some(([source, target]) => {
        return (
          source === "organizationId" ||
          source.startsWith("organizationId.") ||
          target === "organizationId" ||
          String(target).startsWith("organizationId.")
        );
      });
    }
    return updateContainsOrganizationId(nestedValue);
  });
};

/** Rejects post-create changes to an existing `organizationId` schema path. */
export const organizationIdImmutabilityPlugin = (schema: Schema): void => {
  schema.pre("save", function () {
    if (this.isNew || !this.isModified("organizationId")) {
      return;
    }
    throw new BadRequestError(ORGANIZATION_ID_IMMUTABLE_TITLE);
  });

  schema.pre(["updateOne", "findOneAndUpdate"], function () {
    const update = this.getUpdate();
    if (!updateContainsOrganizationId(update)) {
      return;
    }
    throw new BadRequestError(ORGANIZATION_ID_IMMUTABLE_TITLE);
  });
};

/**
 * Adds a required indexed `organizationId` so tenant-scoped consumer models cannot be saved
 * without an organization. After creation, `organizationId` is immutable for REST, admin,
 * sync, and direct saves.
 */
export const orgScopedPlugin = (schema: Schema): void => {
  schema.add({
    organizationId: {
      description: "Organization this document belongs to",
      index: true,
      ref: "TerrenoOrganization",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  });
  organizationIdImmutabilityPlugin(schema);
};
