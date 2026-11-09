import express from "express";

import {asyncHandler, type OpenApiMiddleware} from "./api";
import {
  authenticateMiddleware,
  generateTokens,
  type HasSetPassword,
  isUserDisabled,
  MAX_PASSWORD_LENGTH,
  setPasswordForUser,
  type User,
  type UserModel,
} from "./auth";
import {AuthToken} from "./authTokens";
import {APIError} from "./errors";
import type {AuthOptions, AuthRecoveryMail} from "./expressServer";
import {logger} from "./logger";
import {createOpenApiBuilder} from "./openApiBuilder";
import {findOneOrNoneFor} from "./plugins";

const RESET_PASSWORD_SUBJECT = "Reset your password";
const VERIFY_EMAIL_SUBJECT = "Verify your email";

const resetPasswordText = (resetUrl: string): string =>
  `Reset your password using this link: ${resetUrl}`;

const resetPasswordHtml = (resetUrl: string): string =>
  `<p><a href="${resetUrl}">Reset your password</a></p>`;

const verifyEmailText = (verifyUrl: string): string =>
  `Verify your email using this link: ${verifyUrl}`;

const verifyEmailHtml = (verifyUrl: string): string =>
  `<p><a href="${verifyUrl}">Verify your email</a></p>`;

const normalizeEmail = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
};

const escapeRegularExpression = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const findUserByEmail = async (userModel: UserModel, email: string): Promise<User | null> => {
  return findOneOrNoneFor(userModel, {
    email: {$options: "i", $regex: `^${escapeRegularExpression(email)}$`},
  } as never);
};

const passwordFromBody = (body: Record<string, unknown>): string => {
  if (typeof body.password === "string" && body.password.length > 0) {
    return body.password;
  }
  if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
    return body.newPassword;
  }
  return "";
};

const tokenFromBody = (body: Record<string, unknown>): string => {
  if (typeof body.token === "string") {
    return body.token;
  }
  return "";
};

const buildAppUrl = (publicAppUrl: string | undefined, path: string, token: string): string => {
  const base = (publicAppUrl ?? "").replace(/\/$/, "");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
};

const buildResetUrl = (publicAppUrl: string | undefined, token: string): string => {
  return buildAppUrl(publicAppUrl, "/resetPassword", token);
};

const buildVerifyUrl = (publicAppUrl: string | undefined, token: string): string => {
  return buildAppUrl(publicAppUrl, "/verifyEmail", token);
};

const userEmail = (user: User, fallback = ""): string => {
  if (typeof (user as User & {email?: string}).email === "string") {
    return (user as User & {email: string}).email;
  }
  return fallback;
};

const isEmailVerified = (user: User): boolean => {
  return (user as User & {emailVerified?: boolean}).emailVerified === true;
};

const markEmailVerified = (user: User): void => {
  (user as User & {emailVerified?: boolean}).emailVerified = true;
};

export const sendVerificationEmail = async (
  user: User,
  authOptions?: AuthOptions
): Promise<void> => {
  if (!authOptions?.publicAppUrl) {
    logger.error("[auth] publicAppUrl is required to send verification mail");
    throw new APIError({
      status: 501,
      title: "publicAppUrl is required to send verification mail",
    });
  }
  if (isEmailVerified(user)) {
    return;
  }
  const issued = await AuthToken.issueFor({_id: String(user._id)}, "emailVerification");
  const verifyUrl = buildVerifyUrl(authOptions.publicAppUrl, issued.token);
  await deliverRecoveryMail(authOptions, {
    html: verifyEmailHtml(verifyUrl),
    sensitive: true,
    subject: VERIFY_EMAIL_SUBJECT,
    text: verifyEmailText(verifyUrl),
    to: userEmail(user),
  });
};

const deliverRecoveryMail = async (
  authOptions: AuthOptions | undefined,
  message: AuthRecoveryMail
): Promise<void> => {
  if (authOptions?.sendMail) {
    await authOptions.sendMail(message);
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new APIError({status: 501, title: "Mail is not configured"});
  }
  logger.info(
    `[auth] Console recovery mail subject=${message.subject} textLength=${message.text.length}`
  );
};

const EMAIL_CHANGED_SUBJECT = "Your account email was changed";

const maskSegment = (value: string): string => {
  if (value.length === 0) {
    return "***";
  }
  return `${value[0]}***`;
};

/**
 * Partially mask an email for a notice: `renamed@example.com` becomes `r***@e***.com`. Keeps the
 * first character of the local part and of the domain, plus the top-level domain.
 */
export const maskEmailAddress = (email: string): string => {
  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) {
    return maskSegment(trimmed);
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const dotIndex = domain.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${maskSegment(local)}@${maskSegment(domain)}`;
  }
  return `${maskSegment(local)}@${maskSegment(domain.slice(0, dotIndex))}${domain.slice(dotIndex)}`;
};

const emailChangedText = (maskedNewEmail: string): string =>
  `The email address on your account was changed to ${maskedNewEmail}. ` +
  "If you did not make this change, contact support right away.";

const emailChangedHtml = (maskedNewEmail: string): string =>
  `<p>The email address on your account was changed to ${maskedNewEmail}.</p>` +
  "<p>If you did not make this change, contact support right away.</p>";

/**
 * Tell the previous address that the account email changed. The notice carries no link or token
 * that acts on the account. Without a configured `sendMail` it logs a warning and sends nothing;
 * a delivery failure is logged and never undoes the change.
 */
export const sendEmailChangedNotice = async ({
  authOptions,
  newEmail,
  previousEmail,
}: {
  authOptions?: AuthOptions;
  newEmail: string;
  previousEmail: string;
}): Promise<void> => {
  if (!authOptions?.sendMail) {
    logger.warn(
      "[auth] No sendMail configured; skipped the email change notice to the old address"
    );
    return;
  }
  const maskedNewEmail = maskEmailAddress(newEmail);
  try {
    await authOptions.sendMail({
      html: emailChangedHtml(maskedNewEmail),
      sensitive: true,
      subject: EMAIL_CHANGED_SUBJECT,
      text: emailChangedText(maskedNewEmail),
      to: previousEmail,
    });
  } catch (error: unknown) {
    logger.error("[auth] Failed to send the email change notice to the old address", {error});
  }
};

/** Whether the app User has a legacy JWT (passport) password. */
const hasLegacyPassword = async (userModel: UserModel, user: User): Promise<boolean> => {
  if (userModel.schema.path("hash") === undefined) {
    return false;
  }
  return Boolean(
    await userModel.exists({_id: user._id, hash: {$exists: true, $ne: null}} as never)
  );
};

const incrementTokenEpoch = (user: User): void => {
  user.tokenEpoch = (user.tokenEpoch ?? 0) + 1;
};

const okResponse = {
  data: {
    properties: {ok: {type: "boolean"}},
    required: ["ok"],
    type: "object",
  },
};

// The auth options passed to addAuthRoutes, kept on the app so changeUserPassword can reach the
// Better Auth credential sync that TerrenoApp wires after the routes are added.
const AUTH_OPTIONS_LOCAL_KEY = "terrenoAuthOptions";

const authOptionsFromApp = (app: express.Application | undefined): AuthOptions | undefined =>
  app?.locals?.[AUTH_OPTIONS_LOCAL_KEY] as AuthOptions | undefined;

export interface ChangeUserPasswordOptions {
  /** The admin making the change; recorded in the audit log line, never with the password. */
  adminId?: unknown;
  /** The Express app (`req.app`) the auth routes were added to. */
  app?: express.Application;
  /** Auth options to use instead of the ones registered on `app`. */
  authOptions?: AuthOptions;
}

/**
 * Change a user's password on the server and end the credentials issued before it: sets the
 * passport password, increments `tokenEpoch` (legacy refresh tokens and MCP credentials stop
 * working), saves, and, when Better Auth is registered, sets the Better Auth password and deletes
 * that user's Better Auth sessions. Use it for every server-side password change; calling
 * `setPasswordForUser` alone revokes nothing.
 */
export const changeUserPassword = async (
  user: User,
  password: string,
  options: ChangeUserPasswordOptions = {}
): Promise<void> => {
  const audit = options.adminId === undefined ? undefined : {adminId: options.adminId};
  await setPasswordForUser(user as unknown as HasSetPassword, password, undefined, audit);
  incrementTokenEpoch(user);
  await (user as unknown as {save: () => Promise<unknown>}).save();
  const authOptions = options.authOptions ?? authOptionsFromApp(options.app);
  if (authOptions?.syncPasswordResetToBetterAuth) {
    await authOptions.syncPasswordResetToBetterAuth(user, password);
  }
};

export const addAuthRecoveryRoutes = (
  app: express.Application,
  userModel: UserModel,
  authOptions?: AuthOptions,
  openApi?: OpenApiMiddleware
): void => {
  const openApiOptions = openApi ? {openApi} : {};
  if (authOptions) {
    app.locals[AUTH_OPTIONS_LOCAL_KEY] = authOptions;
  }
  // With Better Auth registered (TerrenoApp wires syncPasswordResetToBetterAuth after these routes
  // are added, so read it per request), the legacy routes only replace an existing JWT password:
  // POST /auth/login has no second factor, so an account without one (such as a social-only
  // account) must not gain a way to sign in there. Pure JWT apps keep today's behaviour.
  const canResetWithLegacyRoute = async (user: User): Promise<boolean> => {
    if (!authOptions?.syncPasswordResetToBetterAuth) {
      return true;
    }
    return hasLegacyPassword(userModel, user);
  };

  const forgotPassword = asyncHandler(async (req: express.Request, res: express.Response) => {
    const email = normalizeEmail(req.body?.email);
    if (email) {
      try {
        const user = await findUserByEmail(userModel, email);
        if (user && !(await canResetWithLegacyRoute(user))) {
          logger.info(
            "[auth] Skipped legacy password reset mail for an account without a JWT password"
          );
        } else if (user) {
          if (!authOptions?.publicAppUrl) {
            logger.error("[auth] publicAppUrl is required to send password reset mail");
          } else {
            const issued = await AuthToken.issueFor({_id: String(user._id)}, "passwordReset");
            const resetUrl = buildResetUrl(authOptions.publicAppUrl, issued.token);
            await deliverRecoveryMail(authOptions, {
              html: resetPasswordHtml(resetUrl),
              sensitive: true,
              subject: RESET_PASSWORD_SUBJECT,
              text: resetPasswordText(resetUrl),
              to: userEmail(user, email),
            });
          }
        }
      } catch (error: unknown) {
        logger.error("[auth] Failed to send password reset mail", {error});
      }
    }
    return res.status(202).json({data: {ok: true}});
  });

  const resetPassword = asyncHandler(async (req: express.Request, res: express.Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = tokenFromBody(body);
    const password = passwordFromBody(body);
    if (!token || !password) {
      throw new APIError({status: 400, title: "token and password are required"});
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new APIError({
        status: 400,
        title: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
      });
    }
    const consumed = await AuthToken.consume(token, "passwordReset");
    if (!consumed) {
      throw new APIError({status: 400, title: "Invalid or expired reset token"});
    }
    const user = await userModel.findById(consumed.userId);
    if (!user) {
      throw new APIError({status: 400, title: "Invalid or expired reset token"});
    }
    if (isUserDisabled(user)) {
      throw new APIError({status: 401, title: "User is disabled"});
    }
    if (!(await canResetWithLegacyRoute(user))) {
      throw new APIError({
        code: "legacy-password-reset-unavailable",
        detail: "Request a new reset link from the sign-in page.",
        status: 400,
        title: "This account cannot reset its password here",
      });
    }
    await changeUserPassword(user, password, {authOptions});
    const tokens = await generateTokens(user, authOptions);
    return res.json({
      data: {refreshToken: tokens.refreshToken, token: tokens.token, userId: user._id},
    });
  });

  const forgotOpenApi = createOpenApiBuilder(openApiOptions)
    .withTags(["auth"])
    .withSummary("Request a password reset email")
    .withDescription(
      "Always returns 202, whether or not an account exists for the email, so accounts cannot be probed."
    )
    .withRequestBody({email: {description: "The account's email address", type: "string"}})
    .withResponse(202, okResponse, {description: "Accepted", required: ["data"]})
    .build();

  const resetOpenApi = createOpenApiBuilder(openApiOptions)
    .withTags(["auth"])
    .withSummary("Reset password with a one-time token")
    .withDescription(
      "Send `token` and either `password` or `newPassword`. Returns fresh tokens for the user."
    )
    .withRequestBody({
      newPassword: {description: "Alias for password", type: "string"},
      password: {description: "The new password", type: "string"},
      token: {description: "One-time reset token from the emailed link", type: "string"},
    })
    .withResponse(
      200,
      {
        data: {
          properties: {
            refreshToken: {type: "string"},
            token: {type: "string"},
            userId: {type: "string"},
          },
          required: ["refreshToken", "token", "userId"],
          type: "object",
        },
      },
      {required: ["data"]}
    )
    .build();

  const sendVerification = asyncHandler(async (req: express.Request, res: express.Response) => {
    const user = req.user as User | undefined;
    if (!user) {
      throw new APIError({status: 401, title: "Unauthorized"});
    }
    await sendVerificationEmail(user, authOptions);
    return res.status(202).json({data: {ok: true}});
  });

  const verifyEmail = asyncHandler(async (req: express.Request, res: express.Response) => {
    const token = tokenFromBody((req.body ?? {}) as Record<string, unknown>);
    if (!token) {
      throw new APIError({status: 400, title: "token is required"});
    }
    const consumed = await AuthToken.consume(token, "emailVerification");
    if (!consumed) {
      throw new APIError({status: 400, title: "Invalid or expired verification token"});
    }
    const user = await userModel.findById(consumed.userId);
    if (!user) {
      throw new APIError({status: 400, title: "Invalid or expired verification token"});
    }
    markEmailVerified(user);
    await (user as unknown as {save: () => Promise<unknown>}).save();
    return res.json({data: {ok: true}});
  });

  const sendVerificationOpenApi = createOpenApiBuilder(openApiOptions)
    .withTags(["auth"])
    .withSummary("Send or resend an email verification link")
    .withResponse(202, okResponse, {description: "Accepted", required: ["data"]})
    .build();

  const verifyEmailOpenApi = createOpenApiBuilder(openApiOptions)
    .withTags(["auth"])
    .withSummary("Verify email with a one-time token")
    .withRequestBody({
      token: {description: "One-time verification token from the emailed link", type: "string"},
    })
    .withResponse(200, okResponse, {required: ["data"]})
    .build();

  const router = express.Router();
  if (authOptions?.passwordReset !== false) {
    router.post("/forgotPassword", forgotOpenApi, forgotPassword);
    router.post("/resetPassword", resetOpenApi, resetPassword);
  }
  if (authOptions?.emailVerification !== false) {
    router.post(
      "/sendVerification",
      authenticateMiddleware(),
      sendVerificationOpenApi,
      sendVerification
    );
    router.post("/verifyEmail", verifyEmailOpenApi, verifyEmail);
  }
  app.use("/auth", router);
  if (authOptions?.passwordReset !== false && authOptions?.legacyResetPasswordRoute !== false) {
    app.post("/resetPassword", resetOpenApi, resetPassword);
  }
};
