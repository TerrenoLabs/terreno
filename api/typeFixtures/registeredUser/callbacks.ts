import type {ActionContext, ModelRouterOptions, PermissionMethod} from "@terreno/api";
import type {} from "@terreno/api/expressUser";

type Ctx = ActionContext<unknown, unknown, unknown>;

export const handler = async ({user}: Ctx): Promise<string | undefined> => user?.name;

export const queryFilter: NonNullable<ModelRouterOptions<unknown>["queryFilter"]> = (user) => ({
  ownerId: user?.name,
});

export const permission: PermissionMethod<unknown> = (_method, user) => user?.name === "x";

declare const req: Express.Request;
export const reqName: string | undefined = req.user?.name;

export const badHandler = async ({user}: Ctx): Promise<unknown> =>
  // @ts-expect-error missingField is not on the registered user
  user?.missingField;
