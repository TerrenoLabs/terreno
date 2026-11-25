import type {TerrenoUserModel} from "../auth";
import {logger} from "../logger";
import type {AnyTerrenoAccess} from "./types";

export interface BackfillAdminsOptions {
  access: AnyTerrenoAccess;
  userModel: TerrenoUserModel;
  roleName?: string;
  wetRun?: boolean;
}

export interface BackfillAdminsResult {
  dryRun: boolean;
  matched: number;
  updated: number;
}

/**
 * Assigns a superadmin (or custom) role to users with `admin: true`.
 * Dry-run by default — pass `wetRun: true` to persist changes.
 */
export const backfillAdmins = async ({
  access,
  userModel,
  roleName = "superadmin",
  wetRun = false,
}: BackfillAdminsOptions): Promise<BackfillAdminsResult> => {
  const admins = await userModel.find({admin: true});
  logger.info(
    `[rbac:backfill-admins] Found ${admins.length} admin user(s); target role=${roleName}; wetRun=${wetRun}`
  );

  let updated = 0;
  for (const user of admins) {
    const rbacUser = user as unknown as {roles?: string[]; save: () => Promise<unknown>};
    const roles = new Set(rbacUser.roles ?? []);
    if (roles.has(roleName)) {
      continue;
    }
    roles.add(roleName);
    if (wetRun) {
      rbacUser.roles = [...roles];
      await user.save();
      access.invalidateCache({userId: user.id});
    }
    updated += 1;
  }

  return {
    dryRun: !wetRun,
    matched: admins.length,
    updated,
  };
};
