import type {RegisteredUser} from "@terreno/api";

/**
 * Opt-in typing for `req.user`. Import it once for its side effect:
 * `import type {} from "@terreno/api/expressUser";`
 *
 * It extends Passport's `Express.User` merge point instead of redeclaring `Request.user`
 * with a different type, so it agrees with `@types/passport` whether or not that is loaded.
 */
declare global {
  namespace Express {
    interface User extends RegisteredUser {}
    interface Request {
      user?: User | undefined;
    }
  }
}

export {};
