import {
  ADMIN_PAGE_ACTION,
  type AnyTerrenoAccess,
  asyncHandler,
  authenticateMiddleware,
  ForbiddenError,
  Permissions,
  UnauthorizedError,
} from "@terreno/api";
import type {NextFunction, Request, RequestHandler, Response} from "express";

export interface ObservabilityRoutePermission {
  action: string;
  resource: string;
}

export interface ObservabilityRouteAccessOptions {
  accessControl?: AnyTerrenoAccess;
  openApi?: unknown;
}

const isLegacyAdmin = (user: unknown): boolean => {
  return Permissions.IsAdmin("read", user as Parameters<typeof Permissions.IsAdmin>[1]);
};

const assertObservabilityRouteAccess = async (
  req: Request,
  accessControl?: AnyTerrenoAccess,
  permission?: ObservabilityRoutePermission
): Promise<void> => {
  const user = req.user;
  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }

  if (!accessControl) {
    if (!isLegacyAdmin(user)) {
      throw new ForbiddenError("Admin access required");
    }
    return;
  }

  if (isLegacyAdmin(user)) {
    return;
  }

  const shell = await accessControl.can({
    permissions: {admin: [ADMIN_PAGE_ACTION]},
    user: user as Parameters<AnyTerrenoAccess["can"]>[0]["user"],
  });
  if (!shell.allowed) {
    throw new ForbiddenError({
      detail: shell.reason,
      title: "Admin access required",
    });
  }

  if (!permission) {
    return;
  }

  const result = await accessControl.can({
    permissions: {[permission.resource]: [permission.action]},
    user: user as Parameters<AnyTerrenoAccess["can"]>[0]["user"],
  });
  if (!result.allowed) {
    throw new ForbiddenError({
      detail: result.reason,
      title: "Observability access denied",
    });
  }
};

export const observabilityAccessMiddleware = (
  accessControl?: AnyTerrenoAccess,
  permission?: ObservabilityRoutePermission
): RequestHandler =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    await assertObservabilityRouteAccess(req, accessControl, permission);
    next();
  });

export const observabilityRouteMiddleware = (
  accessControl?: AnyTerrenoAccess,
  permission?: ObservabilityRoutePermission,
  ...extra: RequestHandler[]
): RequestHandler[] => {
  return [
    authenticateMiddleware(),
    observabilityAccessMiddleware(accessControl, permission),
    ...extra,
  ];
};

export const observabilityReviewMutationMiddleware = (
  accessControl?: AnyTerrenoAccess
): RequestHandler =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const body = req.body as {action?: string};
    const permission: ObservabilityRoutePermission =
      body.action === "assign"
        ? {action: "assign", resource: "aiReview"}
        : {action: "score", resource: "aiReview"};
    await assertObservabilityRouteAccess(req, accessControl, permission);
    next();
  });
