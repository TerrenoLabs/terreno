import {
  type ActionContext,
  type ModelRouterOptions,
  OrgQueryFilter,
  OwnerQueryFilter,
  type PermissionMethod,
} from "@terreno/api";
import type {} from "@terreno/api/expressUser";

type Ctx = ActionContext<unknown, unknown, unknown>;

export const handler = async ({user}: Ctx): Promise<string | undefined> => user?.name;

export const queryFilter: NonNullable<ModelRouterOptions<unknown>["queryFilter"]> = (user) => ({
  ownerId: user?.name,
});

// The built-in query filters accept the registered user, whose `_id` is a document ObjectId.
export const ownerFilter: NonNullable<ModelRouterOptions<unknown>["queryFilter"]> =
  OwnerQueryFilter;
export const orgFilter: NonNullable<ModelRouterOptions<unknown>["queryFilter"]> = OrgQueryFilter;

export const permission: PermissionMethod<unknown> = (_method, user) => user?.name === "x";

declare const req: Express.Request;
export const reqName: string | undefined = req.user?.name;

export const badHandler = async ({user}: Ctx): Promise<unknown> =>
  // @ts-expect-error missingField is not on the registered user
  user?.missingField;
