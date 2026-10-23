/**
 * Security actions: the names, labels, and recording of every account-security event.
 *
 * Admin recovery actions (AccountSecurityApp routes) and self-service changes (a user linking a
 * provider or turning on 2FA) are recorded the same way: an `AuditEvent` with
 * `source: "security"` through the existing audit recorder, plus an in-process event that
 * listeners (security notification emails) subscribe to.
 */

import {DateTime} from "luxon";

import {isAuditRecorderInstalled, recordAuditEvent} from "../audit/record";
import {logger} from "../logger";

/** Who started a security action: an administrator on someone else's account, or the user. */
export type SecurityActionOrigin = "admin" | "self";

export interface SecurityActionDefinition {
  /** Whether the admin UI should confirm before running it. */
  destructive: boolean;
  /** Short label for buttons and audit views. */
  label: string;
  origin: SecurityActionOrigin;
}

/**
 * Every security action name. Admin actions are the recovery routes under
 * `/users/:id/security/*` (and the org-admin prefix); self-service actions are recorded when the
 * user changes their own sign-in methods.
 */
export const SECURITY_ACTIONS = {
  disable: {destructive: true, label: "Disable account", origin: "admin"},
  enable: {destructive: false, label: "Enable account", origin: "admin"},
  "issue-sign-in-link": {destructive: false, label: "Issue sign-in link", origin: "admin"},
  "passkey-added": {destructive: false, label: "Passkey added", origin: "self"},
  "passkey-removed": {destructive: false, label: "Passkey removed", origin: "self"},
  "password-changed": {destructive: false, label: "Password changed", origin: "self"},
  "provider-linked": {destructive: false, label: "Sign-in provider linked", origin: "self"},
  "provider-unlinked": {destructive: false, label: "Sign-in provider unlinked", origin: "self"},
  "remove-passkey": {destructive: true, label: "Remove passkey", origin: "admin"},
  "reset-two-factor": {destructive: true, label: "Reset two-factor", origin: "admin"},
  "revoke-sessions": {destructive: true, label: "Sign out everywhere", origin: "admin"},
  "send-password-reset": {destructive: false, label: "Send password reset", origin: "admin"},
  "suspend-membership": {destructive: true, label: "Suspend membership", origin: "admin"},
  "two-factor-disabled": {destructive: false, label: "Two-factor turned off", origin: "self"},
  "two-factor-enabled": {destructive: false, label: "Two-factor turned on", origin: "self"},
  "unlink-provider": {destructive: true, label: "Unlink provider", origin: "admin"},
} as const satisfies Record<string, SecurityActionDefinition>;

export type SecurityActionId = keyof typeof SECURITY_ACTIONS;

/** A user named by its app User id. */
export interface SecurityPrincipal {
  id: string;
}

/** The organization whose admin acted, for actions run under the org-admin prefix. */
export interface SecurityActionOrg {
  id: string;
  name?: string;
}

export interface RecordSecurityActionArgs {
  action: SecurityActionId;
  /** Who acted. Omit only when no user is known (a system job). */
  actor?: SecurityPrincipal;
  /** Extra fields for the AuditEvent `after`, such as which passkey or provider. No secrets. */
  details?: Record<string, unknown>;
  org?: SecurityActionOrg;
  /** Whose account changed. */
  target: SecurityPrincipal;
}

/** What listeners receive for every recorded security action. */
export interface SecurityActionEvent extends RecordSecurityActionArgs {
  /** ISO timestamp of when the action was recorded. */
  occurredAt: string;
  origin: SecurityActionOrigin;
}

export type SecurityActionListener = (event: SecurityActionEvent) => void | Promise<void>;

const listeners = new Set<SecurityActionListener>();

/**
 * Subscribes to every recorded security action (for example, to email the affected user).
 * Returns the unsubscribe function. A throwing listener is logged and never fails the action.
 */
export const onSecurityAction = (listener: SecurityActionListener): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const clearSecurityActionListenersForTests = (): void => {
  listeners.clear();
};

const notifyListeners = (event: SecurityActionEvent): void => {
  for (const listener of listeners) {
    try {
      const result = listener(event);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          logger.error(`Security action listener failed for ${event.action}`, error);
        });
      }
    } catch (error: unknown) {
      logger.error(`Security action listener failed for ${event.action}`, error);
    }
  }
};

/**
 * Records a security action: one `AuditEvent` (`source: "security"`, `modelName: "User"`,
 * `recordId` the target, `verb: "updated"`, `after: {...details, securityAction,
 * organizationId?}`) when
 * AuditApp is registered, and one event to every {@link onSecurityAction} listener.
 *
 * The audit write follows the recorder's fire-and-forget convention: the returned promise
 * settles when it is persisted (or failed and logged); HTTP handlers do not await it.
 */
export const recordSecurityAction = ({
  action,
  actor,
  details,
  org,
  target,
}: RecordSecurityActionArgs): Promise<void> => {
  const event: SecurityActionEvent = {
    action,
    ...(actor ? {actor} : {}),
    ...(details ? {details} : {}),
    occurredAt: DateTime.now().toUTC().toISO() ?? "",
    ...(org ? {org} : {}),
    origin: SECURITY_ACTIONS[action].origin,
    target,
  };
  notifyListeners(event);
  if (!isAuditRecorderInstalled()) {
    return Promise.resolve();
  }
  return recordAuditEvent({
    actorId: actor?.id,
    after: {
      ...details,
      securityAction: action,
      ...(org ? {organizationId: org.id} : {}),
    },
    modelName: "User",
    operation: "update",
    ...(org ? {organizationId: org.id} : {}),
    recordId: target.id,
    source: "security",
    verb: "updated",
  });
};
