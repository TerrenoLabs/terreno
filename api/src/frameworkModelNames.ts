/** Mongoose compiled names for framework models that used to be generic. */
export const FRAMEWORK_MODEL_PUBLIC_NAMES = {
  TerrenoAnnouncement: "Announcement",
  TerrenoAnnouncementAcknowledgement: "AnnouncementAcknowledgement",
  TerrenoAnnouncementClickEvent: "AnnouncementClickEvent",
  TerrenoAnnouncementImpression: "AnnouncementImpression",
  TerrenoAuditEvent: "AuditEvent",
  TerrenoAuthToken: "AuthToken",
  TerrenoInboxNotification: "Notification",
  TerrenoJob: "Job",
  TerrenoJobSchedule: "JobSchedule",
  TerrenoMcpServiceToken: "McpServiceToken",
  TerrenoMembership: "Membership",
  TerrenoNotificationPreference: "NotificationPreference",
  TerrenoOrganization: "Organization",
  TerrenoWebhookReceipt: "WebhookReceipt",
} as const;

export type FrameworkModelCompiledName = keyof typeof FRAMEWORK_MODEL_PUBLIC_NAMES;

export type FrameworkModelPublicName =
  (typeof FRAMEWORK_MODEL_PUBLIC_NAMES)[FrameworkModelCompiledName];

/**
 * Admin UI keys and `admin<ModelName>` RBAC resources keep the pre-namespace names so
 * consumer statements and `/admin/AuditEvent` routes stay stable.
 */
export const publicFrameworkModelName = (modelName: string): string => {
  if (modelName in FRAMEWORK_MODEL_PUBLIC_NAMES) {
    return FRAMEWORK_MODEL_PUBLIC_NAMES[modelName as FrameworkModelCompiledName];
  }
  return modelName;
};
