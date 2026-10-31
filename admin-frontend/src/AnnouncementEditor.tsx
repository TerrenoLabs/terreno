import {
  Box,
  Button,
  DateTimeField,
  Heading,
  MarkdownEditor,
  MultiselectField,
  NumberField,
  Page,
  SelectField,
  Spinner,
  Text,
  TextField,
  useToast,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {resolveAdminBases} from "./types";
import {useAdminModelApi} from "./useAdminModelApi";
import {
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

type AnnouncementPlatform = "ios" | "android" | "web";
type AnnouncementStatus = "draft" | "published" | "archived";
type AnnouncementDisplayMode = "modal" | "banner" | "feed";
type AnnouncementAudienceType = "staff" | "patient" | "all";
type AcknowledgementPolicy = "required" | "dismiss-only";

interface AnnouncementPrimaryAction {
  label: string;
  url: string;
}

interface AnnouncementConfigResponse {
  defaultAcknowledgementPolicy?: AcknowledgementPolicy;
}

/** Announcement document — shape comes from the consumer's Mongoose model. */
interface AnnouncementDocument {
  _id?: string;
  title?: string;
  body?: string;
  status?: AnnouncementStatus;
  version?: number;
  priority?: number;
  displayMode?: AnnouncementDisplayMode;
  audienceType?: AnnouncementAudienceType;
  acknowledgementPolicy?: AcknowledgementPolicy;
  minBuildNumber?: number | null;
  requiresAcknowledgement?: boolean;
  audience?: unknown;
  publishAt?: string;
  expiresAt?: string;
  platforms?: AnnouncementPlatform[];
  primaryAction?: AnnouncementPrimaryAction;
  [key: string]: unknown;
}

interface AnnouncementEditorProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  id?: string;
  onSave?: (announcement: AnnouncementDocument | undefined) => void;
  onCancel?: () => void;
}

const ANNOUNCEMENT_ADMIN_ROUTE = "/announcements";
const ANNOUNCEMENT_ACTION_ROUTE = "/announcements";
const ANNOUNCEMENT_CONFIG_ROUTE = "/announcements/config";
const DEFAULT_ACKNOWLEDGEMENT_POLICY: AcknowledgementPolicy = "dismiss-only";

const PLATFORM_OPTIONS: {label: string; value: AnnouncementPlatform}[] = [
  {label: "iOS", value: "ios"},
  {label: "Android", value: "android"},
  {label: "Web", value: "web"},
];

const DISPLAY_MODE_OPTIONS: {label: string; value: AnnouncementDisplayMode}[] = [
  {label: "Modal (blocking)", value: "modal"},
  {label: "Banner (non-blocking)", value: "banner"},
  {label: "Feed only (changelog)", value: "feed"},
];

const AUDIENCE_TYPE_OPTIONS: {label: string; value: AnnouncementAudienceType}[] = [
  {label: "All users", value: "all"},
  {label: "Staff", value: "staff"},
  {label: "Patients", value: "patient"},
];

const ACKNOWLEDGEMENT_POLICY_OPTIONS: {label: string; value: AcknowledgementPolicy}[] = [
  {label: "Required (Got it)", value: "required"},
  {label: "Dismiss only", value: "dismiss-only"},
];

const toIsoOrEmpty = (value: unknown): string => {
  if (!value) {
    return "";
  }
  const parsed = DateTime.fromISO(String(value));
  if (!parsed.isValid) {
    return "";
  }
  return parsed.toUTC().toISO() ?? "";
};

const parseAudienceJson = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  return JSON.parse(trimmed) as unknown;
};

const parseMinBuildNumber = (raw: string): number | null | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
};

const ANNOUNCEMENT_TAGS = ["admin_Announcement"] as const;

export const AnnouncementEditor: React.FC<AnnouncementEditorProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  id,
  onSave,
  onCancel,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl, routeBase});
  const isEditMode = Boolean(id);
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<AnnouncementStatus>("draft");
  const [version, setVersion] = useState(1);
  const [priority, setPriority] = useState("0");
  const [displayMode, setDisplayMode] = useState<AnnouncementDisplayMode>("modal");
  const [audienceType, setAudienceType] = useState<AnnouncementAudienceType>("all");
  const [acknowledgementPolicy, setAcknowledgementPolicy] = useState<AcknowledgementPolicy>(
    DEFAULT_ACKNOWLEDGEMENT_POLICY
  );
  const [minBuildNumber, setMinBuildNumber] = useState("");
  const [audienceJson, setAudienceJson] = useState("{}");
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [platforms, setPlatforms] = useState<AnnouncementPlatform[]>(["ios", "android", "web"]);
  const [platformsError, setPlatformsError] = useState("");
  const [primaryActionLabel, setPrimaryActionLabel] = useState("");
  const [primaryActionUrl, setPrimaryActionUrl] = useState("");

  const acknowledgementPolicyTouchedRef = useRef(false);

  const routePath = `${resolvedApiBase}${ANNOUNCEMENT_ADMIN_ROUTE}`;

  const {useReadQuery, useCreateMutation, useUpdateMutation} = useAdminModelApi(
    routePath,
    "Announcement"
  );

  const rpc = useAdminRpc();
  const [publishRpc, {isLoading: isPublishing}] = useAdminRpcMutation(rpc, {
    invalidatesTags: ANNOUNCEMENT_TAGS,
  });
  const [archiveRpc, {isLoading: isArchiving}] = useAdminRpcMutation(rpc, {
    invalidatesTags: ANNOUNCEMENT_TAGS,
  });
  const publishAnnouncement = useCallback(
    (announcementId: string) =>
      publishRpc({method: "POST", url: `${ANNOUNCEMENT_ACTION_ROUTE}/${announcementId}/publish`}),
    [publishRpc]
  );
  const archiveAnnouncement = useCallback(
    (announcementId: string) =>
      archiveRpc({method: "POST", url: `${ANNOUNCEMENT_ACTION_ROUTE}/${announcementId}/archive`}),
    [archiveRpc]
  );
  const {
    data: configData,
    isLoading: isConfigLoading,
    error: configError,
  } = useAdminRpcQuery<AnnouncementConfigResponse>({
    rpc,
    skip: isEditMode,
    transformResponse: unwrapAdminEnvelope,
    url: ANNOUNCEMENT_CONFIG_ROUTE,
  });

  const {data: announcementData, isLoading: isAnnouncementLoading} =
    useReadQuery<AnnouncementDocument>(id ?? "", {
      skip: !isEditMode || !id,
    });

  const [createAnnouncement, {isLoading: isCreating}] = useCreateMutation();
  const [updateAnnouncement, {isLoading: isUpdating}] = useUpdateMutation();

  const handleAcknowledgementPolicyChange = useCallback((value: string) => {
    acknowledgementPolicyTouchedRef.current = true;
    setAcknowledgementPolicy(value as AcknowledgementPolicy);
  }, []);

  // Pre-fill acknowledgement policy from plugin config on create (never overwrite user edits)
  useEffect(() => {
    if (isEditMode || acknowledgementPolicyTouchedRef.current) {
      return;
    }
    if (configError) {
      setAcknowledgementPolicy(DEFAULT_ACKNOWLEDGEMENT_POLICY);
      return;
    }
    if (isConfigLoading || !configData) {
      return;
    }
    const config = configData as AnnouncementConfigResponse;
    const policy = config.defaultAcknowledgementPolicy;
    if (policy === "required" || policy === "dismiss-only") {
      setAcknowledgementPolicy(policy);
    }
  }, [configData, configError, isConfigLoading, isEditMode]);

  // Populate form state when editing an existing announcement
  useEffect(() => {
    if (!announcementData) {
      return;
    }
    setTitle(announcementData.title ?? "");
    setBody(announcementData.body ?? "");
    setStatus((announcementData.status as AnnouncementStatus | undefined) ?? "draft");
    setVersion(typeof announcementData.version === "number" ? announcementData.version : 1);
    setPriority(String(announcementData.priority ?? 0));
    const loadedDisplayMode = announcementData.displayMode as AnnouncementDisplayMode | undefined;
    if (
      loadedDisplayMode === "modal" ||
      loadedDisplayMode === "banner" ||
      loadedDisplayMode === "feed"
    ) {
      setDisplayMode(loadedDisplayMode);
    }
    const loadedAudienceType = announcementData.audienceType as
      | AnnouncementAudienceType
      | undefined;
    if (
      loadedAudienceType === "staff" ||
      loadedAudienceType === "patient" ||
      loadedAudienceType === "all"
    ) {
      setAudienceType(loadedAudienceType);
    }
    const loadedPolicy = announcementData.acknowledgementPolicy as
      | AcknowledgementPolicy
      | undefined;
    if (loadedPolicy === "required" || loadedPolicy === "dismiss-only") {
      acknowledgementPolicyTouchedRef.current = true;
      setAcknowledgementPolicy(loadedPolicy);
    } else if (announcementData.requiresAcknowledgement === true) {
      acknowledgementPolicyTouchedRef.current = true;
      setAcknowledgementPolicy("required");
    } else if (announcementData.requiresAcknowledgement === false) {
      acknowledgementPolicyTouchedRef.current = true;
      setAcknowledgementPolicy("dismiss-only");
    }
    const loadedMinBuild = announcementData.minBuildNumber;
    setMinBuildNumber(
      typeof loadedMinBuild === "number" && loadedMinBuild > 0 ? String(loadedMinBuild) : ""
    );
    setAudienceJson(
      announcementData.audience != null ? JSON.stringify(announcementData.audience, null, 2) : "{}"
    );
    setPublishAt(toIsoOrEmpty(announcementData.publishAt));
    setExpiresAt(toIsoOrEmpty(announcementData.expiresAt));
    if (Array.isArray(announcementData.platforms) && announcementData.platforms.length > 0) {
      setPlatforms(announcementData.platforms as AnnouncementPlatform[]);
    }
    const action = announcementData.primaryAction as AnnouncementPrimaryAction | undefined;
    setPrimaryActionLabel(action?.label ?? "");
    setPrimaryActionUrl(action?.url ?? "");
  }, [announcementData]);

  const handlePlatformsChange = useCallback((values: string[]) => {
    const next = values.filter(
      (value): value is AnnouncementPlatform =>
        value === "ios" || value === "android" || value === "web"
    );
    setPlatforms(next);
    if (next.length > 0) {
      setPlatformsError("");
    }
  }, []);

  const buildPayload = useCallback(() => {
    let audience: unknown = {};
    try {
      audience = parseAudienceJson(audienceJson);
    } catch {
      throw new Error("Audience must be valid JSON");
    }

    const hasPrimaryLabel = Boolean(primaryActionLabel.trim());
    const hasPrimaryUrl = Boolean(primaryActionUrl.trim());
    let primaryAction: AnnouncementPrimaryAction | undefined;
    if (hasPrimaryLabel && hasPrimaryUrl) {
      primaryAction = {label: primaryActionLabel.trim(), url: primaryActionUrl.trim()};
    } else if (hasPrimaryLabel || hasPrimaryUrl) {
      throw new Error("Primary action requires both label and URL");
    }

    const parsedMinBuild = parseMinBuildNumber(minBuildNumber);

    const payload: Record<string, unknown> = {
      acknowledgementPolicy,
      audience,
      audienceType,
      body: body.trim(),
      displayMode,
      platforms,
      priority: parseInt(priority, 10) || 0,
      title: title.trim(),
    };

    if (isEditMode) {
      payload.expiresAt = expiresAt.trim() ? DateTime.fromISO(expiresAt).toUTC().toJSDate() : null;
      payload.minBuildNumber = parsedMinBuild;
      payload.primaryAction = primaryAction ?? null;
      payload.publishAt = publishAt.trim() ? DateTime.fromISO(publishAt).toUTC().toJSDate() : null;
    } else {
      payload.status = status;
      if (expiresAt.trim()) {
        payload.expiresAt = DateTime.fromISO(expiresAt).toUTC().toJSDate();
      }
      if (parsedMinBuild != null) {
        payload.minBuildNumber = parsedMinBuild;
      }
      if (primaryAction) {
        payload.primaryAction = primaryAction;
      }
      if (publishAt.trim()) {
        payload.publishAt = DateTime.fromISO(publishAt).toUTC().toJSDate();
      }
    }

    return payload;
  }, [
    acknowledgementPolicy,
    audienceJson,
    audienceType,
    body,
    displayMode,
    expiresAt,
    isEditMode,
    minBuildNumber,
    platforms,
    primaryActionLabel,
    primaryActionUrl,
    priority,
    publishAt,
    status,
    title,
  ]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!body.trim()) {
      toast.error("Body is required");
      return;
    }
    if (platforms.length === 0) {
      setPlatformsError("Select at least one platform");
      toast.error("Select at least one platform");
      return;
    }

    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid form data");
      return;
    }

    try {
      let result: AnnouncementDocument | undefined;
      if (isEditMode && id) {
        result = (await updateAnnouncement({body: payload, id}).unwrap()) as AnnouncementDocument;
      } else {
        result = (await createAnnouncement(payload).unwrap()) as AnnouncementDocument;
      }
      console.info("Announcement saved", {id: result?._id ?? id});
      onSave?.(result);
    } catch (err) {
      toast.catch(err, `Failed to ${isEditMode ? "update" : "create"} announcement`);
    }
  }, [
    body,
    buildPayload,
    createAnnouncement,
    id,
    isEditMode,
    onSave,
    platforms.length,
    title,
    toast,
    updateAnnouncement,
  ]);

  const handlePublish = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const result = (await publishAnnouncement(id).unwrap()) as {data?: AnnouncementDocument};
      const published = result?.data;
      if (published?.status) {
        setStatus(published.status as AnnouncementStatus);
      }
      console.info("Announcement published", {id});
      toast.success("Announcement published");
    } catch (err) {
      toast.catch(err, "Failed to publish announcement");
    }
  }, [id, publishAnnouncement, toast]);

  const handleArchive = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const result = (await archiveAnnouncement(id).unwrap()) as {data?: AnnouncementDocument};
      const archived = result?.data;
      if (archived?.status) {
        setStatus(archived.status as AnnouncementStatus);
      }
      console.info("Announcement archived", {id});
      toast.success("Announcement archived");
    } catch (err) {
      toast.catch(err, "Failed to archive announcement");
    }
  }, [archiveAnnouncement, id, toast]);

  const statusLabel = useMemo(() => {
    if (status === "published") {
      return `Published (v${version})`;
    }
    if (status === "archived") {
      return "Archived";
    }
    return "Draft";
  }, [status, version]);

  if (isEditMode && isAnnouncementLoading) {
    return (
      <Page color="transparent" maxWidth="100%" padding={0}>
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  const isSaving = isCreating || isUpdating;
  const canPublish = isEditMode && status === "draft";
  const canArchive = isEditMode && status === "published";

  return (
    <Page
      color="transparent"
      footer={
        <Box direction="row" gap={2} justifyContent="between" padding={2}>
          <Box>
            {onCancel && (
              <Button
                onClick={onCancel}
                testID="announcement-cancel-button"
                text="Cancel"
                variant="secondary"
              />
            )}
          </Box>
          <Button
            loading={isSaving}
            onClick={handleSave}
            testID="announcement-save-button"
            text={isEditMode ? "Save" : "Create"}
            variant="primary"
          />
        </Box>
      }
      maxWidth="100%"
      padding={0}
      scroll
    >
      <Box gap={4} padding={4}>
        {isEditMode && (
          <Box alignItems="center" direction="row" justifyContent="between">
            <Heading size="md">{title || "Edit Announcement"}</Heading>
            <Box alignItems="center" direction="row" gap={2}>
              <Text color="secondaryDark" size="sm">
                {statusLabel}
              </Text>
              {canArchive && (
                <Button
                  loading={isArchiving}
                  onClick={handleArchive}
                  testID="announcement-archive-button"
                  text="Archive"
                  variant="secondary"
                />
              )}
              {canPublish && (
                <Button
                  loading={isPublishing}
                  onClick={handlePublish}
                  testID="announcement-publish-button"
                  text="Publish"
                  variant="primary"
                />
              )}
            </Box>
          </Box>
        )}

        <Box gap={3}>
          <Heading size="sm">Content</Heading>
          <TextField
            onChange={setTitle}
            placeholder="Announcement title"
            testID="announcement-title-input"
            title="Title"
            value={title}
          />
          <MarkdownEditor
            onChange={setBody}
            placeholder="Markdown body (supports YouTube and Loom embeds)"
            testID="announcement-body-input"
            title="Body"
            value={body}
          />
        </Box>

        <Box gap={3}>
          <Heading size="sm">Targeting</Heading>
          <SelectField
            helperText="Modal blocks the app; banner is non-blocking; feed is changelog-only."
            onChange={(value) => setDisplayMode(value as AnnouncementDisplayMode)}
            options={DISPLAY_MODE_OPTIONS}
            requireValue
            testID="announcement-display-mode-input"
            title="Display mode"
            value={displayMode}
          />
          <SelectField
            helperText="Staff and patient are composed with your matchAudience callback on the server."
            onChange={(value) => setAudienceType(value as AnnouncementAudienceType)}
            options={AUDIENCE_TYPE_OPTIONS}
            requireValue
            testID="announcement-audience-type-input"
            title="Audience type"
            value={audienceType}
          />
          <SelectField
            helperText="Required shows a Got it action; dismiss-only records an impression when closed."
            onChange={handleAcknowledgementPolicyChange}
            options={ACKNOWLEDGEMENT_POLICY_OPTIONS}
            requireValue
            testID="announcement-acknowledgement-policy-input"
            title="Acknowledgement policy"
            value={acknowledgementPolicy}
          />
          <NumberField
            helperText="Optional minimum client build number for this announcement"
            onChange={setMinBuildNumber}
            testID="announcement-min-build-input"
            title="Minimum build number (optional)"
            type="number"
            value={minBuildNumber}
          />
          <TextField
            helperText="Advanced: opaque JSON passed to matchAudience. Use audience type above for staff/patient/all."
            multiline
            onChange={setAudienceJson}
            placeholder='{"roles": ["premium"]}'
            rows={4}
            testID="announcement-audience-input"
            title="Audience JSON (advanced)"
            value={audienceJson}
          />
        </Box>

        <Box gap={3}>
          <Heading size="sm">Delivery</Heading>
          <NumberField
            onChange={setPriority}
            testID="announcement-priority-input"
            title="Priority"
            type="number"
            value={priority}
          />
          <DateTimeField
            onChange={setPublishAt}
            testID="announcement-publish-at-input"
            title="Publish at (optional)"
            type="datetime"
            value={publishAt}
          />
          <DateTimeField
            onChange={setExpiresAt}
            testID="announcement-expires-at-input"
            title="Expires at (optional)"
            type="datetime"
            value={expiresAt}
          />
          <MultiselectField
            errorText={platformsError}
            helperText="Users only see the announcement on selected platforms."
            onChange={handlePlatformsChange}
            options={PLATFORM_OPTIONS}
            testID="announcement-platforms-input"
            title="Platforms"
            value={platforms}
          />
        </Box>

        <Box gap={3}>
          <Heading size="sm">Primary action (optional)</Heading>
          <TextField
            onChange={setPrimaryActionLabel}
            placeholder="Learn more"
            testID="announcement-primary-label-input"
            title="Button label"
            value={primaryActionLabel}
          />
          <TextField
            onChange={setPrimaryActionUrl}
            placeholder="https://example.com/docs"
            testID="announcement-primary-url-input"
            title="Button URL"
            value={primaryActionUrl}
          />
        </Box>
      </Box>
    </Page>
  );
};
