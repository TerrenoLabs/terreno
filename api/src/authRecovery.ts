import express from "express";

import {asyncHandler} from "./api";
import {
  authenticateMiddleware,
  generateTokens,
  type HasSetPassword,
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

const incrementTokenEpoch = (user: User): void => {
  user.tokenEpoch = (user.tokenEpoch ?? 0) + 1;
};

export const addAuthRecoveryRoutes = (
  app: express.Application,
  userModel: UserModel,
  authOptions?: AuthOptions
): void => {
  const forgotPassword = asyncHandler(async (req: express.Request, res: express.Response) => {
    const email = normalizeEmail(req.body?.email);
    if (email) {
      try {
        const user = await findUserByEmail(userModel, email);
        if (user) {
          if (!authOptions?.publicAppUrl) {
            logger.error("[auth] publicAppUrl is required to send password reset mail");
          } else {
            const issued = await AuthToken.issueFor({_id: String(user._id)}, "passwordReset");
            const resetUrl = buildResetUrl(authOptions.publicAppUrl, issued.token);
            await deliverRecoveryMail(authOptions, {
              html: resetPasswordHtml(resetUrl),
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
    await setPasswordForUser(user as unknown as HasSetPassword, password);
    incrementTokenEpoch(user);
    await (user as unknown as {save: () => Promise<unknown>}).save();
    if (authOptions?.syncPasswordResetToBetterAuth) {
      await authOptions.syncPasswordResetToBetterAuth(user, password);
    }
    const tokens = await generateTokens(user, authOptions);
    return res.json({
      data: {refreshToken: tokens.refreshToken, token: tokens.token, userId: user._id},
    });
  });

  const forgotOpenApi = createOpenApiBuilder({})
    .withTags(["auth"])
    .withSummary("Request a password reset email")
    .withRequestBody({email: {type: "string"}})
    .withResponse(202, {ok: {type: "boolean"}})
    .build();

  const resetOpenApi = createOpenApiBuilder({})
    .withTags(["auth"])
    .withSummary("Reset password with a one-time token")
    .withRequestBody({
      newPassword: {type: "string"},
      password: {type: "string"},
      token: {type: "string"},
    })
    .withResponse(200, {
      refreshToken: {type: "string"},
      token: {type: "string"},
      userId: {type: "string"},
    })
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

  const sendVerificationOpenApi = createOpenApiBuilder({})
    .withTags(["auth"])
    .withSummary("Send or resend an email verification link")
    .withResponse(202, {ok: {type: "boolean"}})
    .build();

  const verifyEmailOpenApi = createOpenApiBuilder({})
    .withTags(["auth"])
    .withSummary("Verify email with a one-time token")
    .withRequestBody({token: {type: "string"}})
    .withResponse(200, {ok: {type: "boolean"}})
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
