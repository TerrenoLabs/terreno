import type {ActionContext} from "@terreno/api";

declare global {
  namespace Express {
    // A consumer's own typing of req.user, in a .ts file so skipLibCheck cannot hide it.
    // If the root entry also declared Request.user, this would fail with TS2717
    // (subsequent property declarations must have the same type).
    interface User {
      custom: true;
    }
    interface Request {
      user?: User | undefined;
    }
  }
}

type Ctx = ActionContext<unknown, unknown, unknown>;

export const handler = async ({user}: Ctx): Promise<boolean | undefined> => user?.admin;

export const badHandler = async ({user}: Ctx): Promise<unknown> =>
  // @ts-expect-error name is not on the default user
  user?.name;

declare const req: Express.Request;
export const custom: true | undefined = req.user?.custom;
