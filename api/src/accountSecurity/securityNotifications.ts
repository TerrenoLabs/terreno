/**
 * Security notification emails: one email to the affected user for every recorded security
 * action, whether an administrator ran it or the user did.
 *
 * HIPAA posture: the emails are generic. They name the change and who made it ("you" or "an
 * administrator", never the admin's name or email), never include tokens, links that sign in,
 * passkey names, or other user-chosen text, and name the organization only when the app opts in
 * with `notifications.includeOrgName` (on a shared inbox an org name can reveal care).
 */

import {DateTime, Duration} from "luxon";

import type {User, UserModel} from "../auth";
import type {BetterAuthConfig} from "../betterAuth";
import {logger} from "../logger";
import {findOneOrNoneFor} from "../plugins";
import type {SecurityActionEvent, SecurityActionId} from "./securityEvents";

/** A mail template: `{{name}}` placeholders are filled from the render data. */
export interface SecurityMailTemplate {
  html?: string;
  subject: string;
  text?: string;
}

/** The template ids security notifications render, one per kind of change. */
export const SECURITY_MAIL_TEMPLATE_IDS = [
  "securityAccountDisabled",
  "securityAccountEnabled",
  "securityMembershipSuspended",
  "securityOtherSessionsRevoked",
  "securityPasskeyAdded",
  "securityPasskeyRemoved",
  "securityPasswordChanged",
  "securityPasswordReset",
  "securityPasswordSet",
  "securityProviderLinked",
  "securityProviderUnlinked",
  "securitySessionsRevoked",
  "securitySignInLinkIssued",
  "securityTwoFactorDisabled",
  "securityTwoFactorEnabled",
] as const;

export type SecurityMailTemplateId = (typeof SECURITY_MAIL_TEMPLATE_IDS)[number];

const paragraphs = (...lines: string[]): string => lines.map((line) => `<p>${line}</p>`).join("");

/**
 * The default notification templates. `@terreno/comms` `DEFAULT_AUTH_MAIL_TEMPLATES` includes
 * them, so `renderAuthMail` renders them too. Data: `actor` ("You" / "An administrator"),
 * `orgClause` ("" or " at {org}"), `orgReference` ("{org}" or "an organization"),
 * `providerName`, `occurredAt`, `appUrl`, and `secureAccountLine`.
 */
export const DEFAULT_SECURITY_MAIL_TEMPLATES: Record<SecurityMailTemplateId, SecurityMailTemplate> =
  {
    securityAccountDisabled: {
      html: paragraphs(
        "{{actor}}{{orgClause}} disabled your account on {{occurredAt}}. You can no longer sign in.",
        "{{secureAccountLine}}"
      ),
      subject: "Your account was disabled",
      text: "{{actor}}{{orgClause}} disabled your account on {{occurredAt}}. You can no longer sign in.\n\n{{secureAccountLine}}",
    },
    securityAccountEnabled: {
      html: paragraphs(
        "{{actor}}{{orgClause}} re-enabled your account on {{occurredAt}}. You can sign in again.",
        "{{secureAccountLine}}"
      ),
      subject: "Your account was re-enabled",
      text: "{{actor}}{{orgClause}} re-enabled your account on {{occurredAt}}. You can sign in again.\n\n{{secureAccountLine}}",
    },
    securityMembershipSuspended: {
      html: paragraphs(
        "{{actor}} suspended your membership in {{orgReference}} on {{occurredAt}}. You can still sign in.",
        "{{secureAccountLine}}"
      ),
      subject: "Your organization membership was suspended",
      text: "{{actor}} suspended your membership in {{orgReference}} on {{occurredAt}}. You can still sign in.\n\n{{secureAccountLine}}",
    },
    securityOtherSessionsRevoked: {
      html: paragraphs(
        "{{actor}}{{orgClause}} signed your account out of every other device on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "Your other sessions were signed out",
      text: "{{actor}}{{orgClause}} signed your account out of every other device on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityPasskeyAdded: {
      html: paragraphs(
        "{{actor}}{{orgClause}} added a passkey to your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "A passkey was added to your account",
      text: "{{actor}}{{orgClause}} added a passkey to your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityPasskeyRemoved: {
      html: paragraphs(
        "{{actor}}{{orgClause}} removed a passkey from your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "A passkey was removed from your account",
      text: "{{actor}}{{orgClause}} removed a passkey from your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityPasswordChanged: {
      html: paragraphs(
        "{{actor}}{{orgClause}} changed the password for your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "Your password was changed",
      text: "{{actor}}{{orgClause}} changed the password for your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityPasswordReset: {
      html: paragraphs(
        "The password for your account was reset with a reset link on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "Your password was reset",
      text: "The password for your account was reset with a reset link on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityPasswordSet: {
      html: paragraphs(
        "{{actor}}{{orgClause}} added a password to your account on {{occurredAt}}. It can now be used to sign in.",
        "{{secureAccountLine}}"
      ),
      subject: "A password was added to your account",
      text: "{{actor}}{{orgClause}} added a password to your account on {{occurredAt}}. It can now be used to sign in.\n\n{{secureAccountLine}}",
    },
    securityProviderLinked: {
      html: paragraphs(
        "{{actor}}{{orgClause}} connected {{providerName}} to your account on {{occurredAt}}. It can now be used to sign in.",
        "{{secureAccountLine}}"
      ),
      subject: "A sign-in method was connected to your account",
      text: "{{actor}}{{orgClause}} connected {{providerName}} to your account on {{occurredAt}}. It can now be used to sign in.\n\n{{secureAccountLine}}",
    },
    securityProviderUnlinked: {
      html: paragraphs(
        "{{actor}}{{orgClause}} disconnected {{providerName}} from your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "A sign-in method was disconnected from your account",
      text: "{{actor}}{{orgClause}} disconnected {{providerName}} from your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securitySessionsRevoked: {
      html: paragraphs(
        "{{actor}}{{orgClause}} signed your account out of every device on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "You were signed out everywhere",
      text: "{{actor}}{{orgClause}} signed your account out of every device on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securitySignInLinkIssued: {
      html: paragraphs(
        "{{actor}}{{orgClause}} created a sign-in link for your account on {{occurredAt}}. The link was given to the administrator, not sent to you.",
        "{{secureAccountLine}}"
      ),
      subject: "A sign-in link was created for your account",
      text: "{{actor}}{{orgClause}} created a sign-in link for your account on {{occurredAt}}. The link was given to the administrator, not sent to you.\n\n{{secureAccountLine}}",
    },
    securityTwoFactorDisabled: {
      html: paragraphs(
        "{{actor}}{{orgClause}} turned off two-step verification for your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "Two-step verification was turned off",
      text: "{{actor}}{{orgClause}} turned off two-step verification for your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
    securityTwoFactorEnabled: {
      html: paragraphs(
        "{{actor}}{{orgClause}} turned on two-step verification for your account on {{occurredAt}}.",
        "{{secureAccountLine}}"
      ),
      subject: "Two-step verification was turned on",
      text: "{{actor}}{{orgClause}} turned on two-step verification for your account on {{occurredAt}}.\n\n{{secureAccountLine}}",
    },
  };

/**
 * Which template each security action sends; every action is listed. `null` sends nothing:
 * `send-password-reset`'s own reset email is the notice, and a second email would be noise.
 * `issue-sign-in-link` emails the user (who always has an email; the action refuses users
 * without one) that a link exists, never the link itself.
 */
export const SECURITY_NOTIFICATION_TEMPLATES: Record<
  SecurityActionId,
  SecurityMailTemplateId | null
> = {
  disable: "securityAccountDisabled",
  enable: "securityAccountEnabled",
  "issue-sign-in-link": "securitySignInLinkIssued",
  "other-sessions-revoked": "securityOtherSessionsRevoked",
  "passkey-added": "securityPasskeyAdded",
  "passkey-removed": "securityPasskeyRemoved",
  "password-changed": "securityPasswordChanged",
  "password-reset": "securityPasswordReset",
  "password-set": "securityPasswordSet",
  "provider-linked": "securityProviderLinked",
  "provider-unlinked": "securityProviderUnlinked",
  "remove-passkey": "securityPasskeyRemoved",
  "reset-two-factor": "securityTwoFactorDisabled",
  "revoke-sessions": "securitySessionsRevoked",
  "send-password-reset": null,
  "suspend-membership": "securityMembershipSuspended",
  "two-factor-disabled": "securityTwoFactorDisabled",
  "two-factor-enabled": "securityTwoFactorEnabled",
  "unlink-provider": "securityProviderUnlinked",
};

/** `notifications` on `AccountSecurityApp`. */
export interface SecurityNotificationsOptions {
  /**
   * Email the affected user about every security action. Defaults to `true`; nothing is sent
   * while no `sendMail` is configured.
   */
  enabled?: boolean;
  /**
   * Name the organization in emails about actions an org-admin ran. Defaults to `false`: on a
   * shared inbox the org name can reveal care.
   */
  includeOrgName?: boolean;
  /**
   * Renders the emails instead of the built-in renderer, for example `@terreno/comms`
   * `renderAuthMail`. Not read from `BetterAuthConfig.renderAuthMail`: a renderer written only
   * for reset and verify mail would answer every security id with one of those. Falls back to
   * the built-in renderer when it throws or returns no subject.
   */
  render?: SecurityMailRenderer;
  /**
   * Send at most one email per user and template in this many minutes, so a burst of the same
   * change (say, signing out other sessions five times) is one email. Defaults to 10; `0` sends
   * every one. Every action is still recorded in the audit log.
   */
  throttleMinutes?: number;
  /**
   * Delivers the emails. Defaults to the registered `BetterAuthApp`'s `sendMail`. Set it with
   * `setupServer`, where there is no `BetterAuthApp` to read.
   */
  sendMail?: BetterAuthConfig["sendMail"];
}

/** A renderer for security notification templates (`@terreno/comms` `renderAuthMail` fits). */
export type SecurityMailRenderer = (options: {
  data: Record<string, string>;
  publicAppUrl: string;
  templateId: SecurityMailTemplateId;
  templates?: Partial<Record<SecurityMailTemplateId, SecurityMailTemplate>>;
}) => SecurityMailTemplate;

/** Default `throttleMinutes`. */
export const DEFAULT_SECURITY_NOTIFICATION_THROTTLE_MINUTES = 10;

const PROVIDER_NAMES: Record<string, string> = {
  apple: "Apple",
  credential: "a password",
  facebook: "Facebook",
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
};

const DEFAULT_PROVIDER_NAME = "a sign-in provider";

const OCCURRED_AT_FORMAT = "LLLL d, yyyy 'at' HH:mm 'UTC'";

const providerNameOf = (details: Record<string, unknown> | undefined): string => {
  const providerId = details?.providerId;
  if (typeof providerId !== "string") {
    return DEFAULT_PROVIDER_NAME;
  }
  return PROVIDER_NAMES[providerId] ?? DEFAULT_PROVIDER_NAME;
};

const occurredAtOf = (occurredAt: string): string => {
  const parsed = DateTime.fromISO(occurredAt, {zone: "utc"});
  return parsed.isValid ? parsed.toFormat(OCCURRED_AT_FORMAT) : occurredAt;
};

const secureAccountLineOf = (appUrl: string): string =>
  appUrl
    ? `If you did not expect this change, contact support right away. You can review your account security at ${appUrl}.`
    : "If you did not expect this change, contact support right away.";

/**
 * The placeholder values for one event. Only fixed phrases, the time, the app URL, a known
 * provider name, and (with `includeOrgName`) the organization name: nothing user-chosen, no
 * tokens, and no admin identity.
 */
export const buildSecurityMailData = ({
  event,
  includeOrgName = false,
  publicAppUrl,
}: {
  event: SecurityActionEvent;
  includeOrgName?: boolean;
  publicAppUrl?: string;
}): Record<string, string> => {
  const isAdmin = event.origin === "admin";
  const orgName = isAdmin && includeOrgName ? (event.org?.name ?? "") : "";
  const appUrl = (publicAppUrl ?? "").replace(/\/$/, "");
  return {
    actor: isAdmin ? "An administrator" : "You",
    appUrl,
    occurredAt: occurredAtOf(event.occurredAt),
    orgClause: orgName ? ` at ${orgName}` : "",
    orgReference: orgName || "an organization",
    providerName: providerNameOf(event.details),
    secureAccountLine: secureAccountLineOf(appUrl),
  };
};

const HTML_ESCAPES: Record<string, string> = {
  "'": "&#39;",
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/** Escapes a value for an HTML body, so an org name cannot inject markup. */
export const escapeMailHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const fill = (value: string, data: Record<string, string>): string =>
  value.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match: string, key: string): string =>
    Object.hasOwn(data, key) ? (data[key] ?? "") : ""
  );

/**
 * Renders a security notification without `@terreno/comms`, from `templates` or the defaults.
 * HTML bodies get HTML-escaped values. Matches `renderAuthMail` output for the same input.
 */
export const renderSecurityMail = ({
  data,
  templateId,
  templates,
}: {
  data: Record<string, string>;
  templateId: SecurityMailTemplateId;
  templates?: Partial<Record<string, SecurityMailTemplate>>;
}): SecurityMailTemplate => {
  const template = templates?.[templateId] ?? DEFAULT_SECURITY_MAIL_TEMPLATES[templateId];
  const htmlData = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, escapeMailHtml(value)])
  );
  return {
    ...(template.html === undefined ? {} : {html: fill(template.html, htmlData)}),
    subject: fill(template.subject, data),
    ...(template.text === undefined ? {} : {text: fill(template.text, data)}),
  };
};

/** The mail settings a notification reads when it is sent. */
export interface SecurityMailConfig {
  authMailTemplates?: BetterAuthConfig["authMailTemplates"];
  publicAppUrl?: string;
  sendMail?: BetterAuthConfig["sendMail"];
}

/**
 * Renders with `render` when the app opted in, falling back to the built-in renderer when there
 * is none or it cannot render the template (throws or returns no subject).
 */
const renderNotification = ({
  config,
  data,
  render,
  templateId,
}: {
  config: SecurityMailConfig;
  data: Record<string, string>;
  render?: SecurityMailRenderer;
  templateId: SecurityMailTemplateId;
}): SecurityMailTemplate => {
  if (render) {
    try {
      const rendered = render({
        data,
        publicAppUrl: config.publicAppUrl ?? "",
        templateId,
        templates: config.authMailTemplates,
      });
      if (rendered?.subject) {
        return rendered;
      }
    } catch (error: unknown) {
      logger.warn(
        `[AccountSecurity] notifications.render could not render ${templateId}: ${error}`
      );
    }
  }
  return renderSecurityMail({data, templateId, templates: config.authMailTemplates});
};

/** The `onSecurityAction` listener {@link createSecurityNotificationListener} builds. */
export interface SecurityNotificationListener {
  (event: SecurityActionEvent): Promise<void>;
  /** How many throttle keys are held (expired ones are pruned on each send). */
  throttleEntryCount: () => number;
}

/** Notifications still being sent, so tests can wait for delivery. */
const pendingNotifications = new Set<Promise<void>>();

const emailOf = (user: User | null): string => {
  const email = (user as (User & {email?: unknown}) | null)?.email;
  return typeof email === "string" ? email.trim() : "";
};

/**
 * Builds the `onSecurityAction` listener that emails the target. Repeats are throttled per
 * target, template, origin (self or admin), and org, so a burst of one change is one email. It sends nothing for actions
 * without a template, when `sendMail` is unset, or when the user has no email. A delivery
 * failure is logged (with the action and user id, never the address) and never fails the action.
 */
export const createSecurityNotificationListener = ({
  getMailConfig,
  getUserModel,
  includeOrgName = false,
  now = (): number => DateTime.now().toMillis(),
  render,
  throttleMinutes = DEFAULT_SECURITY_NOTIFICATION_THROTTLE_MINUTES,
}: {
  getMailConfig: () => SecurityMailConfig;
  getUserModel: () => UserModel;
  includeOrgName?: boolean;
  /** The current time in epoch milliseconds. Tests pass a fake clock. */
  now?: () => number;
  render?: SecurityMailRenderer;
  throttleMinutes?: number;
}): SecurityNotificationListener => {
  // When each throttle key last got an email, in epoch milliseconds.
  const lastSentAt = new Map<string, number>();
  const throttleMillis = Duration.fromObject({minutes: Math.max(0, throttleMinutes)}).toMillis();

  /** Forgets keys whose window has passed, so the map holds only recent senders. */
  const pruneExpired = (current: number): void => {
    for (const [key, sentAt] of lastSentAt) {
      if (current - sentAt >= throttleMillis) {
        lastSentAt.delete(key);
      }
    }
  };

  /** Claims the key's slot; false while an email for it went out too recently. */
  const claimSlot = (key: string): boolean => {
    if (throttleMillis === 0) {
      return true;
    }
    const current = now();
    pruneExpired(current);
    if (lastSentAt.has(key)) {
      return false;
    }
    lastSentAt.set(key, current);
    return true;
  };

  const notify = async (event: SecurityActionEvent): Promise<void> => {
    const templateId = SECURITY_NOTIFICATION_TEMPLATES[event.action];
    if (!templateId) {
      return;
    }
    const config = getMailConfig();
    if (!config.sendMail) {
      return;
    }
    // Who acted is part of the key: an administrator's change must never be swallowed by the
    // user's own change to the same thing a minute earlier (or by another org's admin).
    const slotKey = [event.target.id, templateId, event.origin, event.org?.id ?? ""].join(":");
    if (!claimSlot(slotKey)) {
      return;
    }
    try {
      const user = await findOneOrNoneFor(getUserModel(), {_id: event.target.id});
      const to = emailOf(user as User | null);
      if (!to) {
        return;
      }
      const data = buildSecurityMailData({
        event,
        includeOrgName,
        publicAppUrl: config.publicAppUrl,
      });
      const rendered = renderNotification({config, data, render, templateId});
      await config.sendMail({
        ...(rendered.html === undefined ? {} : {html: rendered.html}),
        subject: rendered.subject,
        text: rendered.text ?? "",
        to,
      });
    } catch (error: unknown) {
      // A failed send frees the slot, so the next change can still reach the user.
      lastSentAt.delete(slotKey);
      logger.error(
        `[AccountSecurity] Security notification failed action=${event.action} userId=${event.target.id}: ${error}`
      );
    }
  };
  const listener = (event: SecurityActionEvent): Promise<void> => {
    const sending = notify(event);
    pendingNotifications.add(sending);
    void sending.finally(() => {
      pendingNotifications.delete(sending);
    });
    return sending;
  };
  return Object.assign(listener, {throttleEntryCount: (): number => lastSentAt.size});
};

/** Resolves once every notification started so far has been sent (or failed and been logged). */
export const flushSecurityNotificationsForTests = async (): Promise<void> => {
  while (pendingNotifications.size > 0) {
    await Promise.all(Array.from(pendingNotifications));
  }
};
