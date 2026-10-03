// biome-ignore-all lint/suspicious/noExplicitAny: types are generated from backend OpenAPI schemas
import {emptySplitApi as api} from "./betterAuthApi";
export const addTagTypes = [
  "ai",
  "observability",
  "gpthistories",
  "gpt",
  "settings",
  "notifications",
  "todos",
  "loadtest",
  "exampleprojects",
  "admin-users",
  "users",
  "comms",
  "admin",
  "featureflags",
  "jobs",
  "harness",
  "harnessconversations",
  "harnesstasks",
  "harnessapprovals",
  "mcpservicetokens",
  "auditevents",
  "consentforms",
  "consentresponses",
  "announcements",
  "announcementacknowledgements",
  "announcementimpressions",
  "announcementclickevents",
  "adminMigrations",
  "notificationpreferences",
  "organizations",
  "mcp",
] as const;
const injectedRtkApi = api
  .enhanceEndpoints({
    addTagTypes,
  })
  .injectEndpoints({
    endpoints: (build) => ({
      adminMigrationsRun: build.mutation<AdminMigrationsRunRes, AdminMigrationsRunArgs>({
        invalidatesTags: ["adminMigrations"],
        query: (queryArg) => ({
          method: "POST",
          params: {
            wetRun: queryArg,
          },
          url: `/admin/migrations/run`,
        }),
      }),
      adminMigrationsStatus: build.query<AdminMigrationsStatusRes, AdminMigrationsStatusArgs>({
        providesTags: ["adminMigrations"],
        query: () => ({url: `/admin/migrations/status`}),
      }),
      aiModels: build.query<AiModelsRes, AiModelsArgs>({
        providesTags: ["ai"],
        query: () => ({url: `/ai/models`}),
      }),
      commsTestPush: build.mutation<CommsTestPushRes, CommsTestPushArgs>({
        invalidatesTags: ["comms"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/comms/dev/testPush`,
        }),
      }),
      createMcpServiceToken: build.mutation<CreateMcpServiceTokenRes, CreateMcpServiceTokenArgs>({
        invalidatesTags: ["mcp"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/mcp/service-tokens`,
        }),
      }),
      deleteAdminAnnouncementsById: build.mutation<
        DeleteAdminAnnouncementsByIdRes,
        DeleteAdminAnnouncementsByIdArgs
      >({
        invalidatesTags: ["announcements"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/announcements/${queryArg}`,
        }),
      }),
      deleteAdminConsentFormsById: build.mutation<
        DeleteAdminConsentFormsByIdRes,
        DeleteAdminConsentFormsByIdArgs
      >({
        invalidatesTags: ["consentforms"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/consent-forms/${queryArg}`,
        }),
      }),
      deleteAdminFeatureFlagsById: build.mutation<
        DeleteAdminFeatureFlagsByIdRes,
        DeleteAdminFeatureFlagsByIdArgs
      >({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/feature-flags/${queryArg}`,
        }),
      }),
      deleteAdminMcpServiceTokensById: build.mutation<
        DeleteAdminMcpServiceTokensByIdRes,
        DeleteAdminMcpServiceTokensByIdArgs
      >({
        invalidatesTags: ["mcpservicetokens"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/mcp-service-tokens/${queryArg}`,
        }),
      }),
      deleteAdminTodosById: build.mutation<DeleteAdminTodosByIdRes, DeleteAdminTodosByIdArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/todos/${queryArg}`,
        }),
      }),
      deleteAdminUsersById: build.mutation<DeleteAdminUsersByIdRes, DeleteAdminUsersByIdArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/admin/users/${queryArg}`,
        }),
      }),
      deleteAiObservabilityDatasetsById: build.mutation<
        DeleteAiObservabilityDatasetsByIdRes,
        DeleteAiObservabilityDatasetsByIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/ai/observability/datasets/${queryArg}`,
        }),
      }),
      deleteAiObservabilityDatasetsByIdItemsAndItemId: build.mutation<
        DeleteAiObservabilityDatasetsByIdItemsAndItemIdRes,
        DeleteAiObservabilityDatasetsByIdItemsAndItemIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/ai/observability/datasets/${queryArg.id}/items/${queryArg.itemId}`,
        }),
      }),
      deleteAiObservabilityEvaluatorsById: build.mutation<
        DeleteAiObservabilityEvaluatorsByIdRes,
        DeleteAiObservabilityEvaluatorsByIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/ai/observability/evaluators/${queryArg}`,
        }),
      }),
      deleteAnnouncementsById: build.mutation<
        DeleteAnnouncementsByIdRes,
        DeleteAnnouncementsByIdArgs
      >({
        invalidatesTags: ["announcements"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/announcements/${queryArg}`,
        }),
      }),
      deleteCommsPushTokensById: build.mutation<
        DeleteCommsPushTokensByIdRes,
        DeleteCommsPushTokensByIdArgs
      >({
        invalidatesTags: ["comms"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/comms/pushTokens/${queryArg}`,
        }),
      }),
      deleteFeatureFlagsFlagsById: build.mutation<
        DeleteFeatureFlagsFlagsByIdRes,
        DeleteFeatureFlagsFlagsByIdArgs
      >({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/feature-flags/flags/${queryArg}`,
        }),
      }),
      deleteGptHistoriesById: build.mutation<DeleteGptHistoriesByIdRes, DeleteGptHistoriesByIdArgs>(
        {
          invalidatesTags: ["gpthistories"],
          query: (queryArg) => ({
            method: "DELETE",
            url: `/gpt/histories/${queryArg}`,
          }),
        }
      ),
      deleteNotificationPreferencesById: build.mutation<
        DeleteNotificationPreferencesByIdRes,
        DeleteNotificationPreferencesByIdArgs
      >({
        invalidatesTags: ["notificationpreferences"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/notification-preferences/${queryArg}`,
        }),
      }),
      deleteNotificationsById: build.mutation<
        DeleteNotificationsByIdRes,
        DeleteNotificationsByIdArgs
      >({
        invalidatesTags: ["notifications"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/notifications/${queryArg}`,
        }),
      }),
      deleteOrgsById: build.mutation<DeleteOrgsByIdRes, DeleteOrgsByIdArgs>({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({method: "DELETE", url: `/orgs/${queryArg}`}),
      }),
      deleteOrgsByIdMembersAndMemberId: build.mutation<
        DeleteOrgsByIdMembersAndMemberIdRes,
        DeleteOrgsByIdMembersAndMemberIdArgs
      >({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/orgs/${queryArg.id}/members/${queryArg.memberId}`,
        }),
      }),
      deleteProjectsById: build.mutation<DeleteProjectsByIdRes, DeleteProjectsByIdArgs>({
        invalidatesTags: ["exampleprojects"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/projects/${queryArg}`,
        }),
      }),
      deleteTodosById: build.mutation<DeleteTodosByIdRes, DeleteTodosByIdArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({method: "DELETE", url: `/todos/${queryArg}`}),
      }),
      deleteUsersById: build.mutation<DeleteUsersByIdRes, DeleteUsersByIdArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({method: "DELETE", url: `/users/${queryArg}`}),
      }),
      getAdminAnnouncementAcknowledgements: build.query<
        GetAdminAnnouncementAcknowledgementsRes,
        GetAdminAnnouncementAcknowledgementsArgs
      >({
        providesTags: ["announcementacknowledgements"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            acknowledgedAt: queryArg.acknowledgedAt,
            announcementId: queryArg.announcementId,
            limit: queryArg.limit,
            page: queryArg.page,
            q: queryArg.q,
            sort: queryArg.sort,
            userId: queryArg.userId,
            version: queryArg.version,
          },
          url: `/admin/announcement-acknowledgements/`,
        }),
      }),
      getAdminAnnouncementAcknowledgementsById: build.query<
        GetAdminAnnouncementAcknowledgementsByIdRes,
        GetAdminAnnouncementAcknowledgementsByIdArgs
      >({
        providesTags: ["announcementacknowledgements"],
        query: (queryArg) => ({
          url: `/admin/announcement-acknowledgements/${queryArg}`,
        }),
      }),
      getAdminAnnouncementClickEvents: build.query<
        GetAdminAnnouncementClickEventsRes,
        GetAdminAnnouncementClickEventsArgs
      >({
        providesTags: ["announcementclickevents"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            action: queryArg.action,
            announcementId: queryArg.announcementId,
            clickedAt: queryArg.clickedAt,
            limit: queryArg.limit,
            page: queryArg.page,
            platform: queryArg.platform,
            q: queryArg.q,
            sort: queryArg.sort,
            userId: queryArg.userId,
            version: queryArg.version,
          },
          url: `/admin/announcement-click-events/`,
        }),
      }),
      getAdminAnnouncementClickEventsById: build.query<
        GetAdminAnnouncementClickEventsByIdRes,
        GetAdminAnnouncementClickEventsByIdArgs
      >({
        providesTags: ["announcementclickevents"],
        query: (queryArg) => ({
          url: `/admin/announcement-click-events/${queryArg}`,
        }),
      }),
      getAdminAnnouncementImpressions: build.query<
        GetAdminAnnouncementImpressionsRes,
        GetAdminAnnouncementImpressionsArgs
      >({
        providesTags: ["announcementimpressions"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            announcementId: queryArg.announcementId,
            limit: queryArg.limit,
            page: queryArg.page,
            platform: queryArg.platform,
            q: queryArg.q,
            sort: queryArg.sort,
            userId: queryArg.userId,
            version: queryArg.version,
            viewedAt: queryArg.viewedAt,
          },
          url: `/admin/announcement-impressions/`,
        }),
      }),
      getAdminAnnouncementImpressionsById: build.query<
        GetAdminAnnouncementImpressionsByIdRes,
        GetAdminAnnouncementImpressionsByIdArgs
      >({
        providesTags: ["announcementimpressions"],
        query: (queryArg) => ({
          url: `/admin/announcement-impressions/${queryArg}`,
        }),
      }),
      getAdminAnnouncements: build.query<GetAdminAnnouncementsRes, GetAdminAnnouncementsArgs>({
        providesTags: ["announcements"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            acknowledgementPolicy: queryArg.acknowledgementPolicy,
            expiresAt: queryArg.expiresAt,
            limit: queryArg.limit,
            page: queryArg.page,
            priority: queryArg.priority,
            publishedAt: queryArg.publishedAt,
            q: queryArg.q,
            sort: queryArg.sort,
            status: queryArg.status,
            title: queryArg.title,
            version: queryArg.version,
          },
          url: `/admin/announcements/`,
        }),
      }),
      getAdminAnnouncementsById: build.query<
        GetAdminAnnouncementsByIdRes,
        GetAdminAnnouncementsByIdArgs
      >({
        providesTags: ["announcements"],
        query: (queryArg) => ({url: `/admin/announcements/${queryArg}`}),
      }),
      getAdminAuditEvents: build.query<GetAdminAuditEventsRes, GetAdminAuditEventsArgs>({
        providesTags: ["auditevents"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            actorId: queryArg.actorId,
            created: queryArg.created,
            limit: queryArg.limit,
            modelName: queryArg.modelName,
            page: queryArg.page,
            q: queryArg.q,
            recordLabel: queryArg.recordLabel,
            sort: queryArg.sort,
            verb: queryArg.verb,
          },
          url: `/admin/audit-events/`,
        }),
      }),
      getAdminAuditEventsById: build.query<GetAdminAuditEventsByIdRes, GetAdminAuditEventsByIdArgs>(
        {
          providesTags: ["auditevents"],
          query: (queryArg) => ({url: `/admin/audit-events/${queryArg}`}),
        }
      ),
      getAdminConfig: build.query<GetAdminConfigRes, GetAdminConfigArgs>({
        providesTags: ["admin"],
        query: () => ({url: `/admin/config`}),
      }),
      getAdminConsentForms: build.query<GetAdminConsentFormsRes, GetAdminConsentFormsArgs>({
        providesTags: ["consentforms"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            active: queryArg.active,
            limit: queryArg.limit,
            order: queryArg.order,
            page: queryArg.page,
            q: queryArg.q,
            slug: queryArg.slug,
            sort: queryArg.sort,
            title: queryArg.title,
            type: queryArg.type,
            version: queryArg.version,
          },
          url: `/admin/consent-forms/`,
        }),
      }),
      getAdminConsentFormsById: build.query<
        GetAdminConsentFormsByIdRes,
        GetAdminConsentFormsByIdArgs
      >({
        providesTags: ["consentforms"],
        query: (queryArg) => ({url: `/admin/consent-forms/${queryArg}`}),
      }),
      getAdminConsentResponses: build.query<
        GetAdminConsentResponsesRes,
        GetAdminConsentResponsesArgs
      >({
        providesTags: ["consentresponses"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            agreed: queryArg.agreed,
            agreedAt: queryArg.agreedAt,
            limit: queryArg.limit,
            locale: queryArg.locale,
            page: queryArg.page,
            q: queryArg.q,
            sort: queryArg.sort,
            userId: queryArg.userId,
          },
          url: `/admin/consent-responses/`,
        }),
      }),
      getAdminConsentResponsesById: build.query<
        GetAdminConsentResponsesByIdRes,
        GetAdminConsentResponsesByIdArgs
      >({
        providesTags: ["consentresponses"],
        query: (queryArg) => ({url: `/admin/consent-responses/${queryArg}`}),
      }),
      getAdminFeatureFlags: build.query<GetAdminFeatureFlagsRes, GetAdminFeatureFlagsArgs>({
        providesTags: ["featureflags"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            archived: queryArg.archived,
            created: queryArg.created,
            defaultVariant: queryArg.defaultVariant,
            enabled: queryArg.enabled,
            key: queryArg.key,
            limit: queryArg.limit,
            name: queryArg.name,
            page: queryArg.page,
            q: queryArg.q,
            sort: queryArg.sort,
            type: queryArg.type,
          },
          url: `/admin/feature-flags/`,
        }),
      }),
      getAdminFeatureFlagsById: build.query<
        GetAdminFeatureFlagsByIdRes,
        GetAdminFeatureFlagsByIdArgs
      >({
        providesTags: ["featureflags"],
        query: (queryArg) => ({url: `/admin/feature-flags/${queryArg}`}),
      }),
      getAdminMcpServiceTokens: build.query<
        GetAdminMcpServiceTokensRes,
        GetAdminMcpServiceTokensArgs
      >({
        providesTags: ["mcpservicetokens"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            created: queryArg.created,
            expiresAt: queryArg.expiresAt,
            lastUsedAt: queryArg.lastUsedAt,
            limit: queryArg.limit,
            name: queryArg.name,
            page: queryArg.page,
            q: queryArg.q,
            revokedAt: queryArg.revokedAt,
            sort: queryArg.sort,
            tokenPrefix: queryArg.tokenPrefix,
            userId: queryArg.userId,
          },
          url: `/admin/mcp-service-tokens/`,
        }),
      }),
      getAdminMcpServiceTokensById: build.query<
        GetAdminMcpServiceTokensByIdRes,
        GetAdminMcpServiceTokensByIdArgs
      >({
        providesTags: ["mcpservicetokens"],
        query: (queryArg) => ({url: `/admin/mcp-service-tokens/${queryArg}`}),
      }),
      getAdminTodos: build.query<GetAdminTodosRes, GetAdminTodosArgs>({
        providesTags: ["todos"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            completed: queryArg.completed,
            created: queryArg.created,
            created_gte: queryArg.createdGte,
            created_lte: queryArg.createdLte,
            limit: queryArg.limit,
            ownerId: queryArg.ownerId,
            page: queryArg.page,
            priority: queryArg.priority,
            q: queryArg.q,
            sort: queryArg.sort,
            tags: queryArg.tags,
            title: queryArg.title,
          },
          url: `/admin/todos/`,
        }),
      }),
      getAdminTodosById: build.query<GetAdminTodosByIdRes, GetAdminTodosByIdArgs>({
        providesTags: ["todos"],
        query: (queryArg) => ({url: `/admin/todos/${queryArg}`}),
      }),
      getAdminUsers: build.query<GetAdminUsersRes, GetAdminUsersArgs>({
        providesTags: ["users"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            admin: queryArg.admin,
            created: queryArg.created,
            email: queryArg.email,
            emailVerified: queryArg.emailVerified,
            limit: queryArg.limit,
            name: queryArg.name,
            page: queryArg.page,
            q: queryArg.q,
            sort: queryArg.sort,
          },
          url: `/admin/users/`,
        }),
      }),
      getAdminUsersById: build.query<GetAdminUsersByIdRes, GetAdminUsersByIdArgs>({
        providesTags: ["users"],
        query: (queryArg) => ({url: `/admin/users/${queryArg}`}),
      }),
      getAiObservabilityDatasets: build.query<
        GetAiObservabilityDatasetsRes,
        GetAiObservabilityDatasetsArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/datasets`}),
      }),
      getAiObservabilityDatasetsById: build.query<
        GetAiObservabilityDatasetsByIdRes,
        GetAiObservabilityDatasetsByIdArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({
          url: `/ai/observability/datasets/${queryArg}`,
        }),
      }),
      getAiObservabilityDatasetsByIdItems: build.query<
        GetAiObservabilityDatasetsByIdItemsRes,
        GetAiObservabilityDatasetsByIdItemsArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({
          url: `/ai/observability/datasets/${queryArg}/items`,
        }),
      }),
      getAiObservabilityEvaluators: build.query<
        GetAiObservabilityEvaluatorsRes,
        GetAiObservabilityEvaluatorsArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/evaluators`}),
      }),
      getAiObservabilityEvaluatorsById: build.query<
        GetAiObservabilityEvaluatorsByIdRes,
        GetAiObservabilityEvaluatorsByIdArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({
          url: `/ai/observability/evaluators/${queryArg}`,
        }),
      }),
      getAiObservabilityEvaluatorsTemplates: build.query<
        GetAiObservabilityEvaluatorsTemplatesRes,
        GetAiObservabilityEvaluatorsTemplatesArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/evaluators/templates`}),
      }),
      getAiObservabilityExperiments: build.query<
        GetAiObservabilityExperimentsRes,
        GetAiObservabilityExperimentsArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/experiments`}),
      }),
      getAiObservabilityExperimentsById: build.query<
        GetAiObservabilityExperimentsByIdRes,
        GetAiObservabilityExperimentsByIdArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({
          url: `/ai/observability/experiments/${queryArg}`,
        }),
      }),
      getAiObservabilityPrompts: build.query<
        GetAiObservabilityPromptsRes,
        GetAiObservabilityPromptsArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({
          params: {
            folder: queryArg.folder,
            include: queryArg.include,
            search: queryArg.search,
          },
          url: `/ai/observability/prompts`,
        }),
      }),
      getAiObservabilityPromptsByName: build.query<
        GetAiObservabilityPromptsByNameRes,
        GetAiObservabilityPromptsByNameArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({url: `/ai/observability/prompts/${queryArg}`}),
      }),
      getAiObservabilityReview: build.query<
        GetAiObservabilityReviewRes,
        GetAiObservabilityReviewArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/review`}),
      }),
      getAiObservabilityReviewById: build.query<
        GetAiObservabilityReviewByIdRes,
        GetAiObservabilityReviewByIdArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({url: `/ai/observability/review/${queryArg}`}),
      }),
      getAiObservabilityStatus: build.query<
        GetAiObservabilityStatusRes,
        GetAiObservabilityStatusArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/status`}),
      }),
      getAiObservabilityTraces: build.query<
        GetAiObservabilityTracesRes,
        GetAiObservabilityTracesArgs
      >({
        providesTags: ["observability"],
        query: () => ({url: `/ai/observability/traces`}),
      }),
      getAiObservabilityTracesById: build.query<
        GetAiObservabilityTracesByIdRes,
        GetAiObservabilityTracesByIdArgs
      >({
        providesTags: ["observability"],
        query: (queryArg) => ({url: `/ai/observability/traces/${queryArg}`}),
      }),
      getAnnouncements: build.query<GetAnnouncementsRes, GetAnnouncementsArgs>({
        providesTags: ["announcements"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            page: queryArg.page,
            priority: queryArg.priority,
            sort: queryArg.sort,
            status: queryArg.status,
            title: queryArg.title,
          },
          url: `/announcements/`,
        }),
      }),
      getAnnouncementsById: build.query<GetAnnouncementsByIdRes, GetAnnouncementsByIdArgs>({
        providesTags: ["announcements"],
        query: (queryArg) => ({url: `/announcements/${queryArg}`}),
      }),
      getAnnouncementsConfig: build.query<GetAnnouncementsConfigRes, GetAnnouncementsConfigArgs>({
        providesTags: ["announcements"],
        query: () => ({url: `/announcements/config`}),
      }),
      getAnnouncementsOverview: build.query<
        GetAnnouncementsOverviewRes,
        GetAnnouncementsOverviewArgs
      >({
        providesTags: ["announcements"],
        query: (queryArg) => ({
          params: {
            limit: queryArg.limit,
            page: queryArg.page,
          },
          url: `/announcements/overview`,
        }),
      }),
      getCommsMessages: build.query<GetCommsMessagesRes, GetCommsMessagesArgs>({
        providesTags: ["admin", "comms"],
        query: (queryArg) => ({
          params: {
            channel: queryArg.channel,
            endDate: queryArg.endDate,
            errorClass: queryArg.errorClass,
            errorCode: queryArg.errorCode,
            limit: queryArg.limit,
            page: queryArg.page,
            provider: queryArg.provider,
            q: queryArg.q,
            retriedFromId: queryArg.retriedFromId,
            startDate: queryArg.startDate,
            status: queryArg.status,
            templateId: queryArg.templateId,
            to: queryArg.to,
            userId: queryArg.userId,
          },
          url: `/comms/messages`,
        }),
      }),
      getCommsMessagesById: build.query<GetCommsMessagesByIdRes, GetCommsMessagesByIdArgs>({
        providesTags: ["admin", "comms"],
        query: (queryArg) => ({url: `/comms/messages/${queryArg}`}),
      }),
      getCommsPushTokens: build.query<GetCommsPushTokensRes, GetCommsPushTokensArgs>({
        providesTags: ["comms"],
        query: (queryArg) => ({
          params: {
            active: queryArg.active,
            limit: queryArg.limit,
            page: queryArg.page,
            platform: queryArg.platform,
          },
          url: `/comms/pushTokens`,
        }),
      }),
      getCommsPushTokensById: build.query<GetCommsPushTokensByIdRes, GetCommsPushTokensByIdArgs>({
        providesTags: ["comms"],
        query: (queryArg) => ({url: `/comms/pushTokens/${queryArg}`}),
      }),
      getCommsStats: build.query<GetCommsStatsRes, GetCommsStatsArgs>({
        providesTags: ["admin", "comms"],
        query: (queryArg) => ({
          params: {
            channel: queryArg.channel,
            endDate: queryArg.endDate,
            errorClass: queryArg.errorClass,
            errorCode: queryArg.errorCode,
            limit: queryArg.limit,
            page: queryArg.page,
            provider: queryArg.provider,
            q: queryArg.q,
            retriedFromId: queryArg.retriedFromId,
            startDate: queryArg.startDate,
            status: queryArg.status,
            templateId: queryArg.templateId,
            to: queryArg.to,
            userId: queryArg.userId,
          },
          url: `/comms/stats`,
        }),
      }),
      getFeatureFlagsFlags: build.query<GetFeatureFlagsFlagsRes, GetFeatureFlagsFlagsArgs>({
        providesTags: ["featureflags"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            page: queryArg.page,
            sort: queryArg.sort,
          },
          url: `/feature-flags/flags/`,
        }),
      }),
      getFeatureFlagsFlagsById: build.query<
        GetFeatureFlagsFlagsByIdRes,
        GetFeatureFlagsFlagsByIdArgs
      >({
        providesTags: ["featureflags"],
        query: (queryArg) => ({url: `/feature-flags/flags/${queryArg}`}),
      }),
      getGptHistories: build.query<GetGptHistoriesRes, GetGptHistoriesArgs>({
        providesTags: ["gpthistories"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            page: queryArg.page,
            projectId: queryArg.projectId,
            sort: queryArg.sort,
            userId: queryArg.userId,
          },
          url: `/gpt/histories/`,
        }),
      }),
      getGptHistoriesById: build.query<GetGptHistoriesByIdRes, GetGptHistoriesByIdArgs>({
        providesTags: ["gpthistories"],
        query: (queryArg) => ({url: `/gpt/histories/${queryArg}`}),
      }),
      getGptTools: build.query<GetGptToolsRes, GetGptToolsArgs>({
        providesTags: ["gpt"],
        query: () => ({url: `/gpt/tools`}),
      }),
      getHarnessApprovals: build.query<GetHarnessApprovalsRes, GetHarnessApprovalsArgs>({
        providesTags: ["harnessapprovals"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            page: queryArg.page,
            rootTaskId: queryArg.rootTaskId,
            sort: queryArg.sort,
            taskId: queryArg.taskId,
          },
          url: `/harness/approvals/`,
        }),
      }),
      getHarnessApprovalsById: build.query<GetHarnessApprovalsByIdRes, GetHarnessApprovalsByIdArgs>(
        {
          providesTags: ["harnessapprovals"],
          query: (queryArg) => ({url: `/harness/approvals/${queryArg}`}),
        }
      ),
      getHarnessConversations: build.query<GetHarnessConversationsRes, GetHarnessConversationsArgs>(
        {
          providesTags: ["harnessconversations"],
          query: (queryArg) => ({
            params: {
              _id: queryArg._id,
              limit: queryArg.limit,
              page: queryArg.page,
              sort: queryArg.sort,
            },
            url: `/harness/conversations/`,
          }),
        }
      ),
      getHarnessConversationsById: build.query<
        GetHarnessConversationsByIdRes,
        GetHarnessConversationsByIdArgs
      >({
        providesTags: ["harnessconversations"],
        query: (queryArg) => ({url: `/harness/conversations/${queryArg}`}),
      }),
      getHarnessTasksById: build.query<GetHarnessTasksByIdRes, GetHarnessTasksByIdArgs>({
        providesTags: ["harnesstasks"],
        query: (queryArg) => ({url: `/harness/tasks/${queryArg}`}),
      }),
      getJobs: build.query<GetJobsRes, GetJobsArgs>({
        providesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          params: {
            end: queryArg.end,
            limit: queryArg.limit,
            name: queryArg.name,
            page: queryArg.page,
            q: queryArg.q,
            scheduleId: queryArg.scheduleId,
            start: queryArg.start,
            status: queryArg.status,
          },
          url: `/jobs`,
        }),
      }),
      getJobsById: build.query<GetJobsByIdRes, GetJobsByIdArgs>({
        providesTags: ["admin", "jobs"],
        query: (queryArg) => ({url: `/jobs/${queryArg}`}),
      }),
      getJobsSchedules: build.query<GetJobsSchedulesRes, GetJobsSchedulesArgs>({
        providesTags: ["admin", "jobs"],
        query: () => ({url: `/jobs/schedules`}),
      }),
      getJobsStats: build.query<GetJobsStatsRes, GetJobsStatsArgs>({
        providesTags: ["admin", "jobs"],
        query: () => ({url: `/jobs/stats`}),
      }),
      getNotificationPreferences: build.query<
        GetNotificationPreferencesRes,
        GetNotificationPreferencesArgs
      >({
        providesTags: ["notificationpreferences"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            ownerId: queryArg.ownerId,
            page: queryArg.page,
            sort: queryArg.sort,
          },
          url: `/notification-preferences/`,
        }),
      }),
      getNotificationPreferencesById: build.query<
        GetNotificationPreferencesByIdRes,
        GetNotificationPreferencesByIdArgs
      >({
        providesTags: ["notificationpreferences"],
        query: (queryArg) => ({url: `/notification-preferences/${queryArg}`}),
      }),
      getNotifications: build.query<GetNotificationsRes, GetNotificationsArgs>({
        providesTags: ["notifications"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            archivedAt: queryArg.archivedAt,
            kind: queryArg.kind,
            limit: queryArg.limit,
            ownerId: queryArg.ownerId,
            page: queryArg.page,
            readAt: queryArg.readAt,
            sort: queryArg.sort,
          },
          url: `/notifications/`,
        }),
      }),
      getNotificationsById: build.query<GetNotificationsByIdRes, GetNotificationsByIdArgs>({
        providesTags: ["notifications"],
        query: (queryArg) => ({url: `/notifications/${queryArg}`}),
      }),
      getOrgs: build.query<GetOrgsRes, GetOrgsArgs>({
        providesTags: ["organizations"],
        query: () => ({url: `/orgs/`}),
      }),
      getOrgsById: build.query<GetOrgsByIdRes, GetOrgsByIdArgs>({
        providesTags: ["organizations"],
        query: (queryArg) => ({url: `/orgs/${queryArg}`}),
      }),
      getOrgsByIdMembers: build.query<GetOrgsByIdMembersRes, GetOrgsByIdMembersArgs>({
        providesTags: ["organizations"],
        query: (queryArg) => ({url: `/orgs/${queryArg}/members`}),
      }),
      getOrgsMine: build.query<GetOrgsMineRes, GetOrgsMineArgs>({
        providesTags: ["organizations"],
        query: () => ({url: `/orgs/mine`}),
      }),
      getProjects: build.query<GetProjectsRes, GetProjectsArgs>({
        providesTags: ["exampleprojects"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            limit: queryArg.limit,
            organizationId: queryArg.organizationId,
            page: queryArg.page,
            sort: queryArg.sort,
            title: queryArg.title,
          },
          url: `/projects/`,
        }),
      }),
      getProjectsById: build.query<GetProjectsByIdRes, GetProjectsByIdArgs>({
        providesTags: ["exampleprojects"],
        query: (queryArg) => ({url: `/projects/${queryArg}`}),
      }),
      getTodos: build.query<GetTodosRes, GetTodosArgs>({
        providesTags: ["todos"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            completed: queryArg.completed,
            limit: queryArg.limit,
            ownerId: queryArg.ownerId,
            page: queryArg.page,
            sort: queryArg.sort,
          },
          url: `/todos/`,
        }),
      }),
      getTodosById: build.query<GetTodosByIdRes, GetTodosByIdArgs>({
        providesTags: ["todos"],
        query: (queryArg) => ({url: `/todos/${queryArg}`}),
      }),
      getUsers: build.query<GetUsersRes, GetUsersArgs>({
        providesTags: ["users"],
        query: (queryArg) => ({
          params: {
            _id: queryArg._id,
            email: queryArg.email,
            limit: queryArg.limit,
            name: queryArg.name,
            page: queryArg.page,
            sort: queryArg.sort,
          },
          url: `/users/`,
        }),
      }),
      getUsersById: build.query<GetUsersByIdRes, GetUsersByIdArgs>({
        providesTags: ["users"],
        query: (queryArg) => ({url: `/users/${queryArg}`}),
      }),
      harnessAbort: build.mutation<HarnessAbortRes, HarnessAbortArgs>({
        invalidatesTags: ["harness"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/harness/tasks/${queryArg.id}/abort`,
        }),
      }),
      harnessApprove: build.mutation<HarnessApproveRes, HarnessApproveArgs>({
        invalidatesTags: ["harness"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/harness/approvals/${queryArg.id}/approve`,
        }),
      }),
      harnessReject: build.mutation<HarnessRejectRes, HarnessRejectArgs>({
        invalidatesTags: ["harness"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/harness/approvals/${queryArg.id}/reject`,
        }),
      }),
      harnessResolveInterrupted: build.mutation<
        HarnessResolveInterruptedRes,
        HarnessResolveInterruptedArgs
      >({
        invalidatesTags: ["harness"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/harness/tasks/${queryArg.id}/resolveInterrupted`,
        }),
      }),
      harnessSubmit: build.mutation<HarnessSubmitRes, HarnessSubmitArgs>({
        invalidatesTags: ["harness"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/harness/conversations/${queryArg.id}/submit`,
        }),
      }),
      listMcpServiceTokens: build.query<ListMcpServiceTokensRes, ListMcpServiceTokensArgs>({
        providesTags: ["mcp"],
        query: (queryArg) => ({
          params: {
            limit: queryArg.limit,
            page: queryArg.page,
          },
          url: `/mcp/service-tokens`,
        }),
      }),
      loadtestLoadtestChurn: build.mutation<LoadtestLoadtestChurnRes, LoadtestLoadtestChurnArgs>({
        invalidatesTags: ["loadtest"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/todos/loadtestChurn`,
        }),
      }),
      loadtestLoadtestClear: build.mutation<LoadtestLoadtestClearRes, LoadtestLoadtestClearArgs>({
        invalidatesTags: ["loadtest"],
        query: () => ({method: "POST", url: `/todos/loadtestClear`}),
      }),
      loadtestLoadtestGenerate: build.mutation<
        LoadtestLoadtestGenerateRes,
        LoadtestLoadtestGenerateArgs
      >({
        invalidatesTags: ["loadtest"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/todos/loadtestGenerate`,
        }),
      }),
      patchAdminAnnouncementsById: build.mutation<
        PatchAdminAnnouncementsByIdRes,
        PatchAdminAnnouncementsByIdArgs
      >({
        invalidatesTags: ["announcements"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/admin/announcements/${queryArg.id}`,
        }),
      }),
      patchAdminConsentFormsById: build.mutation<
        PatchAdminConsentFormsByIdRes,
        PatchAdminConsentFormsByIdArgs
      >({
        invalidatesTags: ["consentforms"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/admin/consent-forms/${queryArg.id}`,
        }),
      }),
      patchAdminFeatureFlagsById: build.mutation<
        PatchAdminFeatureFlagsByIdRes,
        PatchAdminFeatureFlagsByIdArgs
      >({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/admin/feature-flags/${queryArg.id}`,
        }),
      }),
      patchAdminTodosById: build.mutation<PatchAdminTodosByIdRes, PatchAdminTodosByIdArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/admin/todos/${queryArg.id}`,
        }),
      }),
      patchAdminUsersById: build.mutation<PatchAdminUsersByIdRes, PatchAdminUsersByIdArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/admin/users/${queryArg.id}`,
        }),
      }),
      patchAiObservabilityDatasetsById: build.mutation<
        PatchAiObservabilityDatasetsByIdRes,
        PatchAiObservabilityDatasetsByIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "PATCH",
          url: `/ai/observability/datasets/${queryArg}`,
        }),
      }),
      patchAiObservabilityDatasetsByIdItemsAndItemId: build.mutation<
        PatchAiObservabilityDatasetsByIdItemsAndItemIdRes,
        PatchAiObservabilityDatasetsByIdItemsAndItemIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "PATCH",
          url: `/ai/observability/datasets/${queryArg.id}/items/${queryArg.itemId}`,
        }),
      }),
      patchAiObservabilityEvaluatorsById: build.mutation<
        PatchAiObservabilityEvaluatorsByIdRes,
        PatchAiObservabilityEvaluatorsByIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "PATCH",
          url: `/ai/observability/evaluators/${queryArg}`,
        }),
      }),
      patchAnnouncementsById: build.mutation<PatchAnnouncementsByIdRes, PatchAnnouncementsByIdArgs>(
        {
          invalidatesTags: ["announcements"],
          query: (queryArg) => ({
            body: queryArg.body,
            method: "PATCH",
            url: `/announcements/${queryArg.id}`,
          }),
        }
      ),
      patchFeatureFlagsFlagsById: build.mutation<
        PatchFeatureFlagsFlagsByIdRes,
        PatchFeatureFlagsFlagsByIdArgs
      >({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/feature-flags/flags/${queryArg.id}`,
        }),
      }),
      patchGptHistoriesById: build.mutation<PatchGptHistoriesByIdRes, PatchGptHistoriesByIdArgs>({
        invalidatesTags: ["gpthistories"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/gpt/histories/${queryArg.id}`,
        }),
      }),
      patchGptHistoriesByIdRating: build.mutation<
        PatchGptHistoriesByIdRatingRes,
        PatchGptHistoriesByIdRatingArgs
      >({
        invalidatesTags: ["gpt"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/gpt/histories/${queryArg.id}/rating`,
        }),
      }),
      patchNotificationPreferencesById: build.mutation<
        PatchNotificationPreferencesByIdRes,
        PatchNotificationPreferencesByIdArgs
      >({
        invalidatesTags: ["notificationpreferences"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/notification-preferences/${queryArg.id}`,
        }),
      }),
      patchNotificationsById: build.mutation<PatchNotificationsByIdRes, PatchNotificationsByIdArgs>(
        {
          invalidatesTags: ["notifications"],
          query: (queryArg) => ({
            body: queryArg.body,
            method: "PATCH",
            url: `/notifications/${queryArg.id}`,
          }),
        }
      ),
      patchOrgsById: build.mutation<PatchOrgsByIdRes, PatchOrgsByIdArgs>({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/orgs/${queryArg.id}`,
        }),
      }),
      patchOrgsByIdMembersAndMemberId: build.mutation<
        PatchOrgsByIdMembersAndMemberIdRes,
        PatchOrgsByIdMembersAndMemberIdArgs
      >({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/orgs/${queryArg.id}/members/${queryArg.memberId}`,
        }),
      }),
      patchProjectsById: build.mutation<PatchProjectsByIdRes, PatchProjectsByIdArgs>({
        invalidatesTags: ["exampleprojects"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/projects/${queryArg.id}`,
        }),
      }),
      patchTodosById: build.mutation<PatchTodosByIdRes, PatchTodosByIdArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/todos/${queryArg.id}`,
        }),
      }),
      patchUsersById: build.mutation<PatchUsersByIdRes, PatchUsersByIdArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "PATCH",
          url: `/users/${queryArg.id}`,
        }),
      }),
      postAdminAnnouncementAcknowledgementsBulkPatch: build.mutation<
        PostAdminAnnouncementAcknowledgementsBulkPatchRes,
        PostAdminAnnouncementAcknowledgementsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/announcement-acknowledgements/bulk-patch`,
        }),
      }),
      postAdminAnnouncementClickEventsBulkPatch: build.mutation<
        PostAdminAnnouncementClickEventsBulkPatchRes,
        PostAdminAnnouncementClickEventsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/announcement-click-events/bulk-patch`,
        }),
      }),
      postAdminAnnouncementImpressionsBulkPatch: build.mutation<
        PostAdminAnnouncementImpressionsBulkPatchRes,
        PostAdminAnnouncementImpressionsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/announcement-impressions/bulk-patch`,
        }),
      }),
      postAdminAnnouncements: build.mutation<PostAdminAnnouncementsRes, PostAdminAnnouncementsArgs>(
        {
          invalidatesTags: ["announcements"],
          query: (queryArg) => ({
            body: queryArg,
            method: "POST",
            url: `/admin/announcements/`,
          }),
        }
      ),
      postAdminAnnouncementsBulkPatch: build.mutation<
        PostAdminAnnouncementsBulkPatchRes,
        PostAdminAnnouncementsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/announcements/bulk-patch`,
        }),
      }),
      postAdminAuditEventsBulkPatch: build.mutation<
        PostAdminAuditEventsBulkPatchRes,
        PostAdminAuditEventsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/audit-events/bulk-patch`,
        }),
      }),
      postAdminBackgroundTasks: build.mutation<
        PostAdminBackgroundTasksRes,
        PostAdminBackgroundTasksArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/background-tasks`,
        }),
      }),
      postAdminConsentForms: build.mutation<PostAdminConsentFormsRes, PostAdminConsentFormsArgs>({
        invalidatesTags: ["consentforms"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/consent-forms/`,
        }),
      }),
      postAdminConsentFormsBulkPatch: build.mutation<
        PostAdminConsentFormsBulkPatchRes,
        PostAdminConsentFormsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/consent-forms/bulk-patch`,
        }),
      }),
      postAdminConsentResponsesBulkPatch: build.mutation<
        PostAdminConsentResponsesBulkPatchRes,
        PostAdminConsentResponsesBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/consent-responses/bulk-patch`,
        }),
      }),
      postAdminFeatureFlags: build.mutation<PostAdminFeatureFlagsRes, PostAdminFeatureFlagsArgs>({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/feature-flags/`,
        }),
      }),
      postAdminFeatureFlagsBulkPatch: build.mutation<
        PostAdminFeatureFlagsBulkPatchRes,
        PostAdminFeatureFlagsBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/feature-flags/bulk-patch`,
        }),
      }),
      postAdminMcpServiceTokensBulkPatch: build.mutation<
        PostAdminMcpServiceTokensBulkPatchRes,
        PostAdminMcpServiceTokensBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/mcp-service-tokens/bulk-patch`,
        }),
      }),
      postAdminTodos: build.mutation<PostAdminTodosRes, PostAdminTodosArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/todos/`,
        }),
      }),
      postAdminTodosBulkPatch: build.mutation<
        PostAdminTodosBulkPatchRes,
        PostAdminTodosBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/todos/bulk-patch`,
        }),
      }),
      postAdminUsers: build.mutation<PostAdminUsersRes, PostAdminUsersArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/users/`,
        }),
      }),
      postAdminUsersBulkPatch: build.mutation<
        PostAdminUsersBulkPatchRes,
        PostAdminUsersBulkPatchArgs
      >({
        invalidatesTags: ["admin"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/admin/users/bulk-patch`,
        }),
      }),
      postAiExampleSummarize: build.mutation<PostAiExampleSummarizeRes, PostAiExampleSummarizeArgs>(
        {
          invalidatesTags: ["ai", "observability"],
          query: (queryArg) => ({
            body: queryArg,
            method: "POST",
            url: `/ai/example-summarize`,
          }),
        }
      ),
      postAiObservabilityDatasets: build.mutation<
        PostAiObservabilityDatasetsRes,
        PostAiObservabilityDatasetsArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({method: "POST", url: `/ai/observability/datasets`}),
      }),
      postAiObservabilityDatasetsByIdImport: build.mutation<
        PostAiObservabilityDatasetsByIdImportRes,
        PostAiObservabilityDatasetsByIdImportArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/datasets/${queryArg}/import`,
        }),
      }),
      postAiObservabilityDatasetsByIdItems: build.mutation<
        PostAiObservabilityDatasetsByIdItemsRes,
        PostAiObservabilityDatasetsByIdItemsArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/datasets/${queryArg}/items`,
        }),
      }),
      postAiObservabilityEvaluators: build.mutation<
        PostAiObservabilityEvaluatorsRes,
        PostAiObservabilityEvaluatorsArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({method: "POST", url: `/ai/observability/evaluators`}),
      }),
      postAiObservabilityEvaluatorsTemplatesByName: build.mutation<
        PostAiObservabilityEvaluatorsTemplatesByNameRes,
        PostAiObservabilityEvaluatorsTemplatesByNameArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/evaluators/templates/${queryArg}`,
        }),
      }),
      postAiObservabilityExperiments: build.mutation<
        PostAiObservabilityExperimentsRes,
        PostAiObservabilityExperimentsArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({method: "POST", url: `/ai/observability/experiments`}),
      }),
      postAiObservabilityExperimentsByIdPromote: build.mutation<
        PostAiObservabilityExperimentsByIdPromoteRes,
        PostAiObservabilityExperimentsByIdPromoteArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/experiments/${queryArg}/promote`,
        }),
      }),
      postAiObservabilityExperimentsEstimate: build.mutation<
        PostAiObservabilityExperimentsEstimateRes,
        PostAiObservabilityExperimentsEstimateArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({
          method: "POST",
          url: `/ai/observability/experiments/estimate`,
        }),
      }),
      postAiObservabilityPrompts: build.mutation<
        PostAiObservabilityPromptsRes,
        PostAiObservabilityPromptsArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/ai/observability/prompts`,
        }),
      }),
      postAiObservabilityPromptsByNameLabels: build.mutation<
        PostAiObservabilityPromptsByNameLabelsRes,
        PostAiObservabilityPromptsByNameLabelsArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/ai/observability/prompts/${queryArg.name}/labels`,
        }),
      }),
      postAiObservabilityPromptsByNamePlayground: build.mutation<
        PostAiObservabilityPromptsByNamePlaygroundRes,
        PostAiObservabilityPromptsByNamePlaygroundArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/prompts/${queryArg}/playground`,
        }),
      }),
      postAiObservabilityPromptsByNameVersions: build.mutation<
        PostAiObservabilityPromptsByNameVersionsRes,
        PostAiObservabilityPromptsByNameVersionsArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/prompts/${queryArg}/versions`,
        }),
      }),
      postAiObservabilityReviewById: build.mutation<
        PostAiObservabilityReviewByIdRes,
        PostAiObservabilityReviewByIdArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/review/${queryArg}`,
        }),
      }),
      postAiObservabilityTracesAddToDataset: build.mutation<
        PostAiObservabilityTracesAddToDatasetRes,
        PostAiObservabilityTracesAddToDatasetArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({
          method: "POST",
          url: `/ai/observability/traces/add-to-dataset`,
        }),
      }),
      postAiObservabilityTracesByIdScores: build.mutation<
        PostAiObservabilityTracesByIdScoresRes,
        PostAiObservabilityTracesByIdScoresArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          method: "POST",
          url: `/ai/observability/traces/${queryArg}/scores`,
        }),
      }),
      postAiObservabilityTracesReview: build.mutation<
        PostAiObservabilityTracesReviewRes,
        PostAiObservabilityTracesReviewArgs
      >({
        invalidatesTags: ["observability"],
        query: () => ({
          method: "POST",
          url: `/ai/observability/traces/review`,
        }),
      }),
      postAiObservabilityTracesTestMultiStage: build.mutation<
        PostAiObservabilityTracesTestMultiStageRes,
        PostAiObservabilityTracesTestMultiStageArgs
      >({
        invalidatesTags: ["observability"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/ai/observability/traces/test-multi-stage`,
        }),
      }),
      postAnnouncements: build.mutation<PostAnnouncementsRes, PostAnnouncementsArgs>({
        invalidatesTags: ["announcements"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/announcements/`,
        }),
      }),
      postAnnouncementsImportRelease: build.mutation<
        PostAnnouncementsImportReleaseRes,
        PostAnnouncementsImportReleaseArgs
      >({
        invalidatesTags: ["announcements"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/announcements/import-release`,
        }),
      }),
      postCommsMessagesByIdRetry: build.mutation<
        PostCommsMessagesByIdRetryRes,
        PostCommsMessagesByIdRetryArgs
      >({
        invalidatesTags: ["admin", "comms"],
        query: (queryArg) => ({
          method: "POST",
          url: `/comms/messages/${queryArg}/retry`,
        }),
      }),
      postCommsMessagesRetryMany: build.mutation<
        PostCommsMessagesRetryManyRes,
        PostCommsMessagesRetryManyArgs
      >({
        invalidatesTags: ["admin", "comms"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/comms/messages/retryMany`,
        }),
      }),
      postCommsPushTokens: build.mutation<PostCommsPushTokensRes, PostCommsPushTokensArgs>({
        invalidatesTags: ["comms"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/comms/pushTokens`,
        }),
      }),
      postFeatureFlagsFlags: build.mutation<PostFeatureFlagsFlagsRes, PostFeatureFlagsFlagsArgs>({
        invalidatesTags: ["featureflags"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/feature-flags/flags/`,
        }),
      }),
      postGptHistories: build.mutation<PostGptHistoriesRes, PostGptHistoriesArgs>({
        invalidatesTags: ["gpthistories"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/gpt/histories/`,
        }),
      }),
      postGptPrompt: build.mutation<PostGptPromptRes, PostGptPromptArgs>({
        invalidatesTags: ["gpt"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/gpt/prompt`,
        }),
      }),
      postGptRemix: build.mutation<PostGptRemixRes, PostGptRemixArgs>({
        invalidatesTags: ["gpt"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/gpt/remix`,
        }),
      }),
      postJobsByIdCancel: build.mutation<PostJobsByIdCancelRes, PostJobsByIdCancelArgs>({
        invalidatesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          method: "POST",
          url: `/jobs/${queryArg}/cancel`,
        }),
      }),
      postJobsByIdRequeue: build.mutation<PostJobsByIdRequeueRes, PostJobsByIdRequeueArgs>({
        invalidatesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          method: "POST",
          url: `/jobs/${queryArg}/requeue`,
        }),
      }),
      postJobsByIdRetry: build.mutation<PostJobsByIdRetryRes, PostJobsByIdRetryArgs>({
        invalidatesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          method: "POST",
          url: `/jobs/${queryArg}/retry`,
        }),
      }),
      postJobsSchedulesByNamePause: build.mutation<
        PostJobsSchedulesByNamePauseRes,
        PostJobsSchedulesByNamePauseArgs
      >({
        invalidatesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          method: "POST",
          url: `/jobs/schedules/${queryArg}/pause`,
        }),
      }),
      postJobsSchedulesByNameResume: build.mutation<
        PostJobsSchedulesByNameResumeRes,
        PostJobsSchedulesByNameResumeArgs
      >({
        invalidatesTags: ["admin", "jobs"],
        query: (queryArg) => ({
          method: "POST",
          url: `/jobs/schedules/${queryArg}/resume`,
        }),
      }),
      postNotificationPreferences: build.mutation<
        PostNotificationPreferencesRes,
        PostNotificationPreferencesArgs
      >({
        invalidatesTags: ["notificationpreferences"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/notification-preferences/`,
        }),
      }),
      postNotificationsDevNotify: build.mutation<
        PostNotificationsDevNotifyRes,
        PostNotificationsDevNotifyArgs
      >({
        invalidatesTags: ["notifications"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/notifications/dev/notify`,
        }),
      }),
      postNotificationsMarkAllRead: build.mutation<
        PostNotificationsMarkAllReadRes,
        PostNotificationsMarkAllReadArgs
      >({
        invalidatesTags: ["notifications"],
        query: () => ({method: "POST", url: `/notifications/mark-all-read`}),
      }),
      postOrgs: build.mutation<PostOrgsRes, PostOrgsArgs>({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/orgs/`,
        }),
      }),
      postOrgsByIdMembers: build.mutation<PostOrgsByIdMembersRes, PostOrgsByIdMembersArgs>({
        invalidatesTags: ["organizations"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/orgs/${queryArg.id}/members`,
        }),
      }),
      postProjects: build.mutation<PostProjectsRes, PostProjectsArgs>({
        invalidatesTags: ["exampleprojects"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/projects/`,
        }),
      }),
      postTodos: build.mutation<PostTodosRes, PostTodosArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/todos/`,
        }),
      }),
      postUsers: build.mutation<PostUsersRes, PostUsersArgs>({
        invalidatesTags: ["users"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/users/`,
        }),
      }),
      postUsersByIdPassword: build.mutation<PostUsersByIdPasswordRes, PostUsersByIdPasswordArgs>({
        invalidatesTags: ["admin-users"],
        query: (queryArg) => ({
          body: queryArg.body,
          method: "POST",
          url: `/users/${queryArg.id}/password`,
        }),
      }),
      revokeMcpServiceToken: build.mutation<RevokeMcpServiceTokenRes, RevokeMcpServiceTokenArgs>({
        invalidatesTags: ["mcp"],
        query: (queryArg) => ({
          method: "DELETE",
          url: `/mcp/service-tokens/${queryArg}`,
        }),
      }),
      settingsClearGcs: build.mutation<SettingsClearGcsRes, SettingsClearGcsArgs>({
        invalidatesTags: ["settings"],
        query: () => ({method: "POST", url: `/settings/clearGcs`}),
      }),
      settingsConfigureGcs: build.mutation<SettingsConfigureGcsRes, SettingsConfigureGcsArgs>({
        invalidatesTags: ["settings"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/settings/configureGcs`,
        }),
      }),
      settingsGcs: build.query<SettingsGcsRes, SettingsGcsArgs>({
        providesTags: ["settings"],
        query: () => ({url: `/settings/gcs`}),
      }),
      todosBulkComplete: build.mutation<TodosBulkCompleteRes, TodosBulkCompleteArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          body: queryArg,
          method: "POST",
          url: `/todos/bulkComplete`,
        }),
      }),
      todosMarkComplete: build.mutation<TodosMarkCompleteRes, TodosMarkCompleteArgs>({
        invalidatesTags: ["todos"],
        query: (queryArg) => ({
          method: "POST",
          url: `/todos/${queryArg}/markComplete`,
        }),
      }),
    }),
    overrideExisting: false,
  });

export {injectedRtkApi as openapi};
export type PostAiExampleSummarizeRes = /** status 200 Success */ {
  data?: {
    output?: string;
  };
};
export type PostAiExampleSummarizeArgs = {
  text?: string;
};
export type PostGptHistoriesRes = /** status 201 Successful create */ {
  /** Project this conversation belongs to */
  projectId?: string;
  /** Ordered list of messages in this conversation */
  prompts?: {
    /** Arguments passed to a tool call */
    args?: any;
    /** Multipart content attached to this prompt */
    content?: {
      /** Original filename of the attached file */
      filename?: string;
      /** MIME type of the content part */
      mimeType?: string;
      /** Text content of this part */
      text?: string;
      /** The kind of content this part represents */
      type: "text" | "image" | "file";
      /** URL pointing to the content resource */
      url?: string;
    }[];
    /** AI model identifier used for this prompt */
    model?: string;
    /** User feedback rating for this prompt */
    rating?: "up" | "down";
    /** Result returned from a tool call */
    result?: any;
    /** Text content of the prompt or response */
    text: string;
    /** Identifier linking a tool result to its originating call */
    toolCallId?: string;
    /** Name of the tool that was invoked */
    toolName?: string;
    /** Role of this message in the conversation */
    type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  }[];
  /** Auto-generated title from the first assistant response */
  title?: string;
  /** The user who owns this conversation history */
  userId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  ownerId?: any;
};
export type PostGptHistoriesArgs = {
  /** Project this conversation belongs to */
  projectId?: string;
  /** Ordered list of messages in this conversation */
  prompts?: {
    /** Arguments passed to a tool call */
    args?: any;
    /** Multipart content attached to this prompt */
    content?: {
      /** Original filename of the attached file */
      filename?: string;
      /** MIME type of the content part */
      mimeType?: string;
      /** Text content of this part */
      text?: string;
      /** The kind of content this part represents */
      type: "text" | "image" | "file";
      /** URL pointing to the content resource */
      url?: string;
    }[];
    /** AI model identifier used for this prompt */
    model?: string;
    /** User feedback rating for this prompt */
    rating?: "up" | "down";
    /** Result returned from a tool call */
    result?: any;
    /** Text content of the prompt or response */
    text: string;
    /** Identifier linking a tool result to its originating call */
    toolCallId?: string;
    /** Name of the tool that was invoked */
    toolName?: string;
    /** Role of this message in the conversation */
    type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  }[];
  /** Auto-generated title from the first assistant response */
  title?: string;
  /** The user who owns this conversation history */
  userId?: string;
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  ownerId?: any;
};
export type GetGptHistoriesRes = /** status 200 Successful list */ {
  data?: {
    /** Project this conversation belongs to */
    projectId?: string;
    /** Ordered list of messages in this conversation */
    prompts?: {
      /** Arguments passed to a tool call */
      args?: any;
      /** Multipart content attached to this prompt */
      content?: {
        /** Original filename of the attached file */
        filename?: string;
        /** MIME type of the content part */
        mimeType?: string;
        /** Text content of this part */
        text?: string;
        /** The kind of content this part represents */
        type: "text" | "image" | "file";
        /** URL pointing to the content resource */
        url?: string;
      }[];
      /** AI model identifier used for this prompt */
      model?: string;
      /** User feedback rating for this prompt */
      rating?: "up" | "down";
      /** Result returned from a tool call */
      result?: any;
      /** Text content of the prompt or response */
      text: string;
      /** Identifier linking a tool result to its originating call */
      toolCallId?: string;
      /** Name of the tool that was invoked */
      toolName?: string;
      /** Role of this message in the conversation */
      type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
    }[];
    /** Auto-generated title from the first assistant response */
    title?: string;
    /** The user who owns this conversation history */
    userId: string;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    ownerId?: any;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetGptHistoriesArgs = {
  _id?: {
    $in?: string[];
  };
  userId?:
    | any
    | {
        $in?: any[];
      };
  projectId?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetGptHistoriesByIdRes = /** status 200 Successful read */ {
  /** Project this conversation belongs to */
  projectId?: string;
  /** Ordered list of messages in this conversation */
  prompts?: {
    /** Arguments passed to a tool call */
    args?: any;
    /** Multipart content attached to this prompt */
    content?: {
      /** Original filename of the attached file */
      filename?: string;
      /** MIME type of the content part */
      mimeType?: string;
      /** Text content of this part */
      text?: string;
      /** The kind of content this part represents */
      type: "text" | "image" | "file";
      /** URL pointing to the content resource */
      url?: string;
    }[];
    /** AI model identifier used for this prompt */
    model?: string;
    /** User feedback rating for this prompt */
    rating?: "up" | "down";
    /** Result returned from a tool call */
    result?: any;
    /** Text content of the prompt or response */
    text: string;
    /** Identifier linking a tool result to its originating call */
    toolCallId?: string;
    /** Name of the tool that was invoked */
    toolName?: string;
    /** Role of this message in the conversation */
    type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  }[];
  /** Auto-generated title from the first assistant response */
  title?: string;
  /** The user who owns this conversation history */
  userId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  ownerId?: any;
};
export type GetGptHistoriesByIdArgs = string;
export type PatchGptHistoriesByIdRes = /** status 200 Successful update */ {
  /** Project this conversation belongs to */
  projectId?: string;
  /** Ordered list of messages in this conversation */
  prompts?: {
    /** Arguments passed to a tool call */
    args?: any;
    /** Multipart content attached to this prompt */
    content?: {
      /** Original filename of the attached file */
      filename?: string;
      /** MIME type of the content part */
      mimeType?: string;
      /** Text content of this part */
      text?: string;
      /** The kind of content this part represents */
      type: "text" | "image" | "file";
      /** URL pointing to the content resource */
      url?: string;
    }[];
    /** AI model identifier used for this prompt */
    model?: string;
    /** User feedback rating for this prompt */
    rating?: "up" | "down";
    /** Result returned from a tool call */
    result?: any;
    /** Text content of the prompt or response */
    text: string;
    /** Identifier linking a tool result to its originating call */
    toolCallId?: string;
    /** Name of the tool that was invoked */
    toolName?: string;
    /** Role of this message in the conversation */
    type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
  }[];
  /** Auto-generated title from the first assistant response */
  title?: string;
  /** The user who owns this conversation history */
  userId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  ownerId?: any;
};
export type PatchGptHistoriesByIdArgs = {
  id: string;
  body: {
    /** Project this conversation belongs to */
    projectId?: string;
    /** Ordered list of messages in this conversation */
    prompts?: {
      /** Arguments passed to a tool call */
      args?: any;
      /** Multipart content attached to this prompt */
      content?: {
        /** Original filename of the attached file */
        filename?: string;
        /** MIME type of the content part */
        mimeType?: string;
        /** Text content of this part */
        text?: string;
        /** The kind of content this part represents */
        type: "text" | "image" | "file";
        /** URL pointing to the content resource */
        url?: string;
      }[];
      /** AI model identifier used for this prompt */
      model?: string;
      /** User feedback rating for this prompt */
      rating?: "up" | "down";
      /** Result returned from a tool call */
      result?: any;
      /** Text content of the prompt or response */
      text: string;
      /** Identifier linking a tool result to its originating call */
      toolCallId?: string;
      /** Name of the tool that was invoked */
      toolName?: string;
      /** Role of this message in the conversation */
      type: "user" | "assistant" | "system" | "tool-call" | "tool-result";
    }[];
    /** Auto-generated title from the first assistant response */
    title?: string;
    /** The user who owns this conversation history */
    userId?: string;
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    ownerId?: any;
  };
};
export type DeleteGptHistoriesByIdRes = unknown;
export type DeleteGptHistoriesByIdArgs = string;
export type PostGptPromptRes = /** status 200 Success */ {
  data?: string;
};
export type PostGptPromptArgs = {
  attachments?: {
    filename?: string;
    mimeType?: string;
    type?: string;
    url?: string;
  }[];
  historyId?: string;
  model?: string;
  projectId?: string;
  prompt?: string;
  promptLabel?: string;
  promptName?: string;
  sensitive?: boolean;
  sessionId?: string;
  systemPrompt?: string;
};
export type PatchGptHistoriesByIdRatingRes = /** status 200 Success */ {
  data?: object;
};
export type PatchGptHistoriesByIdRatingArgs = {
  id: string;
  body: {
    promptIndex?: number;
    rating?: string;
  };
};
export type PostGptRemixRes = /** status 200 Success */ {
  data?: string;
};
export type PostGptRemixArgs = {
  promptLabel?: string;
  promptName?: string;
  sensitive?: boolean;
  sessionId?: string;
  text?: string;
};
export type GetGptToolsRes = /** status 200 Success */ {
  data?: {
    description?: string;
    name?: string;
    source?: string;
  }[];
};
export type GetGptToolsArgs = undefined;
export type AiModelsRes = /** status 200 Successful response */ {
  data?: object;
};
export type AiModelsArgs = undefined;
export type SettingsClearGcsRes = /** status 200 Successful response */ {
  data: {
    configured: boolean;
    message: string;
  };
};
export type SettingsClearGcsArgs = undefined;
export type SettingsConfigureGcsRes = /** status 200 Successful response */ {
  data: {
    configured: boolean;
    message: string;
  };
};
export type SettingsConfigureGcsArgs = {
  bucketName: string;
  projectId?: string;
  serviceAccountKey?: string;
};
export type SettingsGcsRes = /** status 200 Successful response */ {
  data: {
    bucketName: string | null;
    configured: boolean;
    hasCredentials: boolean;
    projectId: string | null;
  };
};
export type SettingsGcsArgs = undefined;
export type PostNotificationsDevNotifyRes = /** status 200 Success */ {
  data?: {
    notificationId?: string;
  };
};
export type PostNotificationsDevNotifyArgs = {
  body?: string;
  href?: string;
  kind?: string;
  title?: string;
};
export type TodosMarkCompleteRes = /** status 200 Successful response */ {
  data?: object;
};
export type TodosMarkCompleteArgs = string;
export type LoadtestLoadtestChurnRes = /** status 200 Successful response */ {
  data: {
    created: number;
    deleted: number;
    updated: number;
  };
};
export type LoadtestLoadtestChurnArgs = {
  creates?: number | null;
  deletes?: number | null;
  updates?: number | null;
};
export type LoadtestLoadtestClearRes = /** status 200 Successful response */ {
  data: {
    deleted: number;
  };
};
export type LoadtestLoadtestClearArgs = undefined;
export type LoadtestLoadtestGenerateRes = /** status 200 Successful response */ {
  data: {
    created: number;
  };
};
export type LoadtestLoadtestGenerateArgs = {
  count?: number | null;
};
export type TodosBulkCompleteRes = /** status 200 Successful response */ {
  data: {
    matched: number;
    modified: number;
  };
};
export type TodosBulkCompleteArgs = {
  ids: string[];
};
export type PostTodosRes = /** status 201 Successful create */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PostTodosArgs = {
  /** The document id (String so offline sync clients can mint ids) */
  _id?: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId?: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetTodosRes = /** status 200 Successful list */ {
  data?: {
    /** The document id (String so offline sync clients can mint ids) */
    _id: string;
    /** Whether the todo item has been completed */
    completed?: boolean;
    /** The user who owns this todo */
    ownerId: string;
    /** Priority level of the todo */
    priority?: "low" | "medium" | "high";
    /** Free-form tags for categorization */
    tags?: string[];
    /** The title of the todo item */
    title: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetTodosArgs = {
  _id?: {
    $in?: string[];
  };
  completed?:
    | boolean
    | {
        $in?: boolean[];
      };
  ownerId?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetTodosByIdRes = /** status 200 Successful read */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetTodosByIdArgs = string;
export type PatchTodosByIdRes = /** status 200 Successful update */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PatchTodosByIdArgs = {
  id: string;
  body: {
    /** The document id (String so offline sync clients can mint ids) */
    _id?: string;
    /** Whether the todo item has been completed */
    completed?: boolean;
    /** The user who owns this todo */
    ownerId?: string;
    /** Priority level of the todo */
    priority?: "low" | "medium" | "high";
    /** Free-form tags for categorization */
    tags?: string[];
    /** The title of the todo item */
    title?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  };
};
export type DeleteTodosByIdRes = unknown;
export type DeleteTodosByIdArgs = string;
export type PostProjectsRes = /** status 201 Successful create */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** The organization (tenant) this project belongs to */
  organizationId?: string;
  /** The title of the project */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PostProjectsArgs = {
  /** The document id (String so offline sync clients can mint ids) */
  _id?: string;
  /** The organization (tenant) this project belongs to */
  organizationId?: string;
  /** The title of the project */
  title?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetProjectsRes = /** status 200 Successful list */ {
  data?: {
    /** The document id (String so offline sync clients can mint ids) */
    _id: string;
    /** The organization (tenant) this project belongs to */
    organizationId?: string;
    /** The title of the project */
    title: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetProjectsArgs = {
  _id?: {
    $in?: string[];
  };
  organizationId?:
    | string
    | {
        $in?: string[];
      };
  title?:
    | string
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetProjectsByIdRes = /** status 200 Successful read */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** The organization (tenant) this project belongs to */
  organizationId?: string;
  /** The title of the project */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetProjectsByIdArgs = string;
export type PatchProjectsByIdRes = /** status 200 Successful update */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** The organization (tenant) this project belongs to */
  organizationId?: string;
  /** The title of the project */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PatchProjectsByIdArgs = {
  id: string;
  body: {
    /** The document id (String so offline sync clients can mint ids) */
    _id?: string;
    /** The organization (tenant) this project belongs to */
    organizationId?: string;
    /** The title of the project */
    title?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  };
};
export type DeleteProjectsByIdRes = unknown;
export type DeleteProjectsByIdArgs = string;
export type PostUsersByIdPasswordRes = /** status 200 Successful response */ {
  data: {
    _id: string;
    message: string;
  };
};
export type PostUsersByIdPasswordArgs = {
  id: string;
  body: {
    password: string;
  };
};
export type PostUsersRes = /** status 201 Successful create */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostUsersArgs = {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email?: string;
  /** The user's display name */
  name?: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id?: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetUsersRes = /** status 200 Successful list */ {
  data?: {
    /** Whether the user has admin privileges */
    admin?: boolean;
    /** Identifier linking to the Better Auth session provider */
    betterAuthId?: string;
    /** The user's email address, used for authentication */
    email: string;
    /** The user's display name */
    name: string;
    /** OAuth provider used for authentication */
    oauthProvider?: "google" | "github" | "apple" | null;
    /** Incremented on password reset to invalidate outstanding refresh tokens */
    tokenEpoch?: number;
    _id: string;
    hash?: string;
    salt?: string;
    /** RBAC role names assigned to this user */
    roles?: string[];
    /** Whether the user has verified their email address */
    emailVerified?: boolean;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetUsersArgs = {
  _id?: {
    $in?: string[];
  };
  email?:
    | string
    | {
        $in?: string[];
      };
  name?:
    | string
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetUsersByIdRes = /** status 200 Successful read */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetUsersByIdArgs = string;
export type PatchUsersByIdRes = /** status 200 Successful update */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchUsersByIdArgs = {
  id: string;
  body: {
    /** Whether the user has admin privileges */
    admin?: boolean;
    /** Identifier linking to the Better Auth session provider */
    betterAuthId?: string;
    /** The user's email address, used for authentication */
    email?: string;
    /** The user's display name */
    name?: string;
    /** OAuth provider used for authentication */
    oauthProvider?: "google" | "github" | "apple" | null;
    /** Incremented on password reset to invalidate outstanding refresh tokens */
    tokenEpoch?: number;
    _id?: string;
    hash?: string;
    salt?: string;
    /** RBAC role names assigned to this user */
    roles?: string[];
    /** Whether the user has verified their email address */
    emailVerified?: boolean;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteUsersByIdRes = unknown;
export type DeleteUsersByIdArgs = string;
export type CommsTestPushRes = /** status 200 Successful response */ {
  data?: object;
};
export type CommsTestPushArgs = {
  body?: string;
  title?: string;
};
export type PostCommsPushTokensRes =
  | /** status 200 Success */ {
      data?: object;
    }
  | /** status 201 Success */ {
      data?: object;
    };
export type PostCommsPushTokensArgs = {
  deviceId?: string;
  /** Device platform: android, ios, or web */
  platform: string;
  token: string;
};
export type GetCommsPushTokensRes = /** status 200 Success */ {
  data?: object[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetCommsPushTokensArgs = {
  page?: number;
  limit?: number;
  active?: boolean;
  platform?: string;
};
export type DeleteCommsPushTokensByIdRes = /** status 204 Success */ {};
export type DeleteCommsPushTokensByIdArgs = string;
export type GetCommsPushTokensByIdRes = /** status 200 Successful read */ {
  /** Whether the device token is available for push delivery */
  active?: boolean;
  /** Application-provided identifier for the device */
  deviceId?: string;
  /** Most recent time the device token was registered */
  lastSeenAt: string;
  /** Platform associated with the device token */
  platform: "android" | "ios" | "web";
  /** Push provider token identifying the device */
  token: string;
  /** User who owns the device token */
  userId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  ownerId?: any;
};
export type GetCommsPushTokensByIdArgs = string;
export type GetCommsMessagesRes = /** status 200 Success */ {
  data?: object[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetCommsMessagesArgs = {
  page?: number;
  limit?: number;
  channel?: string;
  provider?: string;
  status?: string;
  errorClass?: string;
  errorCode?: string;
  userId?: string;
  to?: string;
  templateId?: string;
  retriedFromId?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
};
export type PostCommsMessagesRetryManyRes = /** status 200 Success */ {
  retried?: object[];
  skipped?: object[];
};
export type PostCommsMessagesRetryManyArgs = {
  channel?: string;
  endDate?: string;
  errorClass?: string;
  errorCode?: string;
  limit?: number;
  provider?: string;
  q?: string;
  retriedFromId?: string;
  startDate?: string;
  status?: string;
  templateId?: string;
  to?: string;
  userId?: string;
};
export type GetCommsMessagesByIdRes = /** status 200 Success */ {
  data?: object;
};
export type GetCommsMessagesByIdArgs = string;
export type PostCommsMessagesByIdRetryRes = /** status 200 Success */ {
  data?: object;
};
export type PostCommsMessagesByIdRetryArgs = string;
export type GetCommsStatsRes = /** status 200 Success */ {
  buckets?: object[];
  byProvider?: object[];
  totals?: object;
};
export type GetCommsStatsArgs = {
  page?: number;
  limit?: number;
  channel?: string;
  provider?: string;
  status?: string;
  errorClass?: string;
  errorCode?: string;
  userId?: string;
  to?: string;
  templateId?: string;
  retriedFromId?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
};
export type PostFeatureFlagsFlagsRes = /** status 201 Successful create */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostFeatureFlagsFlagsArgs = {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key?: string;
  /** Human-readable display name */
  name?: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetFeatureFlagsFlagsRes = /** status 200 Successful list */ {
  data?: {
    /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
    archived?: boolean;
    /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
    defaultVariant?: string;
    /** Explanation of what this flag controls */
    description?: string;
    /** Global kill switch — if false, flag is off for everyone */
    enabled?: boolean;
    /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
    key: string;
    /** Human-readable display name */
    name: string;
    /** For boolean flags with no matching rules: percentage of users who get true */
    rolloutPercentage?: number;
    rules?: {
      /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
      enabled?: boolean;
      /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
      field?: string;
      /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
      operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
      /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
      segment?: string;
      /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
      value?: any;
      /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
      variant?: string;
      _id?: string;
    }[];
    /** Boolean toggle or multi-variant A/B test */
    type?: "boolean" | "variant";
    variants?: {
      /** Variant identifier, e.g., 'control', 'variant-a' */
      key: string;
      /** Percentage weight for assignment (0-100, all must sum to 100) */
      weight: number;
      _id?: string;
    }[];
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetFeatureFlagsFlagsArgs = {
  _id?: {
    $in?: string[];
  };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetFeatureFlagsFlagsByIdRes = /** status 200 Successful read */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetFeatureFlagsFlagsByIdArgs = string;
export type PatchFeatureFlagsFlagsByIdRes = /** status 200 Successful update */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchFeatureFlagsFlagsByIdArgs = {
  id: string;
  body: {
    /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
    archived?: boolean;
    /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
    defaultVariant?: string;
    /** Explanation of what this flag controls */
    description?: string;
    /** Global kill switch — if false, flag is off for everyone */
    enabled?: boolean;
    /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
    key?: string;
    /** Human-readable display name */
    name?: string;
    /** For boolean flags with no matching rules: percentage of users who get true */
    rolloutPercentage?: number;
    rules?: {
      /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
      enabled?: boolean;
      /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
      field?: string;
      /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
      operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
      /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
      segment?: string;
      /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
      value?: any;
      /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
      variant?: string;
      _id?: string;
    }[];
    /** Boolean toggle or multi-variant A/B test */
    type?: "boolean" | "variant";
    variants?: {
      /** Variant identifier, e.g., 'control', 'variant-a' */
      key: string;
      /** Percentage weight for assignment (0-100, all must sum to 100) */
      weight: number;
      _id?: string;
    }[];
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteFeatureFlagsFlagsByIdRes = unknown;
export type DeleteFeatureFlagsFlagsByIdArgs = string;
export type GetJobsSchedulesRes = /** status 200 Success */ {
  data?: {
    cron?: string;
    enabled?: boolean;
    handlerName?: string;
    id?: string;
    name?: string;
    nextRunAt?: string;
    timezone?: string;
  }[];
};
export type GetJobsSchedulesArgs = undefined;
export type PostJobsSchedulesByNamePauseRes = /** status 200 Success */ {
  data?: object;
};
export type PostJobsSchedulesByNamePauseArgs = string;
export type PostJobsSchedulesByNameResumeRes = /** status 200 Success */ {
  data?: object;
};
export type PostJobsSchedulesByNameResumeArgs = string;
export type GetJobsRes = /** status 200 Success */ {
  data?: {
    _id?: string;
    attemptCount?: number;
    id?: string;
    name?: string;
    status?: string;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetJobsArgs = {
  page?: number;
  limit?: number;
  name?: string;
  status?: string;
  scheduleId?: string;
  start?: string;
  end?: string;
  q?: string;
};
export type GetJobsStatsRes = /** status 200 Success */ {
  data?: {
    byStatus?: object;
    total?: number;
  };
};
export type GetJobsStatsArgs = undefined;
export type GetJobsByIdRes = /** status 200 Success */ {
  data?: object;
};
export type GetJobsByIdArgs = string;
export type PostJobsByIdRetryRes = /** status 200 Success */ {
  data?: object;
};
export type PostJobsByIdRetryArgs = string;
export type PostJobsByIdRequeueRes = /** status 200 Success */ {
  data?: object;
};
export type PostJobsByIdRequeueArgs = string;
export type PostJobsByIdCancelRes = /** status 200 Success */ {
  data?: object;
};
export type PostJobsByIdCancelArgs = string;
export type GetAiObservabilityStatusRes = /** status 200 Success */ {
  data?: object;
};
export type GetAiObservabilityStatusArgs = undefined;
export type GetAiObservabilityPromptsRes = /** status 200 Success */ {
  data?: any;
};
export type GetAiObservabilityPromptsArgs = {
  folder?: string;
  search?: string;
  include?: string;
};
export type PostAiObservabilityPromptsRes = /** status 201 Success */ {
  data?: object;
};
export type PostAiObservabilityPromptsArgs = {
  folder: string;
  name: string;
};
export type GetAiObservabilityPromptsByNameRes = /** status 200 Success */ {
  data?: object;
};
export type GetAiObservabilityPromptsByNameArgs = string;
export type PostAiObservabilityPromptsByNameVersionsRes = /** status 201 Success */ {
  data?: object;
};
export type PostAiObservabilityPromptsByNameVersionsArgs = string;
export type PostAiObservabilityPromptsByNameLabelsRes = /** status 200 Success */ {
  data?: object;
};
export type PostAiObservabilityPromptsByNameLabelsArgs = {
  name: string;
  body: {
    label: string;
    version: number;
  };
};
export type PostAiObservabilityPromptsByNamePlaygroundRes = /** status 200 Success */ {
  data?: object;
};
export type PostAiObservabilityPromptsByNamePlaygroundArgs = string;
export type GetAiObservabilityEvaluatorsTemplatesRes = /** status 200 Success */ {
  data?: any;
};
export type GetAiObservabilityEvaluatorsTemplatesArgs = undefined;
export type PostAiObservabilityEvaluatorsTemplatesByNameRes = /** status 201 Success */ {
  data?: object;
};
export type PostAiObservabilityEvaluatorsTemplatesByNameArgs = string;
export type GetAiObservabilityEvaluatorsRes = /** status 200 Success */ {
  data?: any;
};
export type GetAiObservabilityEvaluatorsArgs = undefined;
export type PostAiObservabilityEvaluatorsRes = /** status 201 Success */ {
  data?: object;
};
export type PostAiObservabilityEvaluatorsArgs = undefined;
export type GetAiObservabilityEvaluatorsByIdRes = /** status 200 Success */ {
  data?: object;
};
export type GetAiObservabilityEvaluatorsByIdArgs = string;
export type PatchAiObservabilityEvaluatorsByIdRes = /** status 200 Success */ {
  data?: object;
};
export type PatchAiObservabilityEvaluatorsByIdArgs = string;
export type DeleteAiObservabilityEvaluatorsByIdRes = /** status 204 Success */ {};
export type DeleteAiObservabilityEvaluatorsByIdArgs = string;
export type PostAiObservabilityTracesReviewRes = /** status 201 Success */ {
  data?: any;
};
export type PostAiObservabilityTracesReviewArgs = undefined;
export type GetAiObservabilityReviewRes = /** status 200 Success */ {
  data?: any;
};
export type GetAiObservabilityReviewArgs = undefined;
export type GetAiObservabilityReviewByIdRes = /** status 200 Success */ {
  data?: object;
};
export type GetAiObservabilityReviewByIdArgs = string;
export type PostAiObservabilityReviewByIdRes = /** status 200 Success */ {
  data?: object;
};
export type PostAiObservabilityReviewByIdArgs = string;
export type GetAiObservabilityDatasetsRes = /** status 200 Success */ {};
export type GetAiObservabilityDatasetsArgs = undefined;
export type PostAiObservabilityDatasetsRes = /** status 201 Success */ {};
export type PostAiObservabilityDatasetsArgs = undefined;
export type GetAiObservabilityDatasetsByIdRes = /** status 200 Success */ {};
export type GetAiObservabilityDatasetsByIdArgs = string;
export type PatchAiObservabilityDatasetsByIdRes = /** status 200 Success */ {};
export type PatchAiObservabilityDatasetsByIdArgs = string;
export type DeleteAiObservabilityDatasetsByIdRes = /** status 204 Success */ {};
export type DeleteAiObservabilityDatasetsByIdArgs = string;
export type GetAiObservabilityDatasetsByIdItemsRes = /** status 200 Success */ {};
export type GetAiObservabilityDatasetsByIdItemsArgs = string;
export type PostAiObservabilityDatasetsByIdItemsRes = /** status 201 Success */ {};
export type PostAiObservabilityDatasetsByIdItemsArgs = string;
export type PatchAiObservabilityDatasetsByIdItemsAndItemIdRes = /** status 200 Success */ {};
export type PatchAiObservabilityDatasetsByIdItemsAndItemIdArgs = {
  id: string;
  itemId: string;
};
export type DeleteAiObservabilityDatasetsByIdItemsAndItemIdRes = /** status 204 Success */ {};
export type DeleteAiObservabilityDatasetsByIdItemsAndItemIdArgs = {
  id: string;
  itemId: string;
};
export type PostAiObservabilityDatasetsByIdImportRes = /** status 200 Success */ {};
export type PostAiObservabilityDatasetsByIdImportArgs = string;
export type PostAiObservabilityTracesAddToDatasetRes = /** status 201 Success */ {};
export type PostAiObservabilityTracesAddToDatasetArgs = undefined;
export type PostAiObservabilityExperimentsEstimateRes = /** status 200 Success */ {};
export type PostAiObservabilityExperimentsEstimateArgs = undefined;
export type GetAiObservabilityExperimentsRes = /** status 200 Success */ {};
export type GetAiObservabilityExperimentsArgs = undefined;
export type PostAiObservabilityExperimentsRes = /** status 201 Success */ {};
export type PostAiObservabilityExperimentsArgs = undefined;
export type GetAiObservabilityExperimentsByIdRes = /** status 200 Success */ {};
export type GetAiObservabilityExperimentsByIdArgs = string;
export type PostAiObservabilityExperimentsByIdPromoteRes = /** status 200 Success */ {};
export type PostAiObservabilityExperimentsByIdPromoteArgs = string;
export type GetAiObservabilityTracesRes = /** status 200 Success */ {
  data?: any;
};
export type GetAiObservabilityTracesArgs = undefined;
export type GetAiObservabilityTracesByIdRes = /** status 200 Success */ {
  data?: object;
};
export type GetAiObservabilityTracesByIdArgs = string;
export type PostAiObservabilityTracesByIdScoresRes = /** status 201 Success */ {
  data?: object;
};
export type PostAiObservabilityTracesByIdScoresArgs = string;
export type PostAiObservabilityTracesTestMultiStageRes = /** status 200 Success */ {
  data?: {
    output?: {
      keywords?: string[];
      metrics?: object;
      phrase?: string;
      sentence?: string;
    };
    stages?: {
      name?: string;
      status?: string;
    }[];
    traceId?: string;
  };
};
export type PostAiObservabilityTracesTestMultiStageArgs = {
  input?: string;
};
export type HarnessSubmitRes = /** status 200 Successful response */ {
  data?: object;
};
export type HarnessSubmitArgs = {
  id: string;
  body: {
    content: string;
    requestId: string;
    whenBusy?: "queue" | "steer";
  };
};
export type GetHarnessConversationsRes = /** status 200 Successful list */ {
  data?: {
    /** Turn task running on this conversation while it is busy */
    activeTurnTaskId?: string;
    agent?: {
      /** Extension names applied to this conversation's requests */
      extensions?: string[];
      /** Models tried in order after the primary model's retries run out */
      fallbackModels?: {
        /** Provider model id, for example claude-sonnet-5-5 */
        modelId?: string;
        /** Provider name the models resolver understands */
        provider?: string;
      }[];
      /** System prompt sent with every model request */
      instructions?: string;
      /** Model requests one turn may make */
      maxSteps?: number;
      model?: {
        /** Provider model id, for example claude-sonnet-5-5 */
        modelId?: string;
        /** Provider name the models resolver understands */
        provider?: string;
      };
      /** Registered agent definition name */
      name: string;
      /** Serialized JSON Schema the final answer must match (subagent structured output) */
      outputSchema?: string;
      /** Tool names the model may call in this conversation */
      tools?: string[];
    };
    /** Deterministic key of the rt.runAgent call (phase visit, attempt, call index) that created this subagent conversation */
    ownerKey?: string;
    ownership?: {
      /** Owning task id for a subagent conversation; empty for root conversations */
      id?: string;
      /** What owns this conversation: nothing (root) or a task (subagent) */
      kind?: "root" | "task";
    };
    /** Submissions waiting on the active turn, oldest first: queued for a later turn, or steering the active one */
    queued?: {
      /** Submitted user content */
      content?: any;
      /** Caller idempotency key of the submission */
      requestId?: string;
      /** When the submission arrived */
      submittedAt?: string;
      /** queue: run as its own turn later; steer: join the active turn's next model request */
      whenBusy?: "queue" | "steer";
    }[];
    /** Highest message sequence number handed out; messages count up from 1 */
    seq?: number;
    /** idle, or busy while a turn task runs */
    status?: "busy" | "idle";
    /** User the conversation belongs to; turn tasks run as this user */
    userId?: string;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetHarnessConversationsArgs = {
  _id?: {
    $in?: string[];
  };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetHarnessConversationsByIdRes = /** status 200 Successful read */ {
  /** Turn task running on this conversation while it is busy */
  activeTurnTaskId?: string;
  agent?: {
    /** Extension names applied to this conversation's requests */
    extensions?: string[];
    /** Models tried in order after the primary model's retries run out */
    fallbackModels?: {
      /** Provider model id, for example claude-sonnet-5-5 */
      modelId?: string;
      /** Provider name the models resolver understands */
      provider?: string;
    }[];
    /** System prompt sent with every model request */
    instructions?: string;
    /** Model requests one turn may make */
    maxSteps?: number;
    model?: {
      /** Provider model id, for example claude-sonnet-5-5 */
      modelId?: string;
      /** Provider name the models resolver understands */
      provider?: string;
    };
    /** Registered agent definition name */
    name: string;
    /** Serialized JSON Schema the final answer must match (subagent structured output) */
    outputSchema?: string;
    /** Tool names the model may call in this conversation */
    tools?: string[];
  };
  /** Deterministic key of the rt.runAgent call (phase visit, attempt, call index) that created this subagent conversation */
  ownerKey?: string;
  ownership?: {
    /** Owning task id for a subagent conversation; empty for root conversations */
    id?: string;
    /** What owns this conversation: nothing (root) or a task (subagent) */
    kind?: "root" | "task";
  };
  /** Submissions waiting on the active turn, oldest first: queued for a later turn, or steering the active one */
  queued?: {
    /** Submitted user content */
    content?: any;
    /** Caller idempotency key of the submission */
    requestId?: string;
    /** When the submission arrived */
    submittedAt?: string;
    /** queue: run as its own turn later; steer: join the active turn's next model request */
    whenBusy?: "queue" | "steer";
  }[];
  /** Highest message sequence number handed out; messages count up from 1 */
  seq?: number;
  /** idle, or busy while a turn task runs */
  status?: "busy" | "idle";
  /** User the conversation belongs to; turn tasks run as this user */
  userId?: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetHarnessConversationsByIdArgs = string;
export type HarnessAbortRes = /** status 200 Successful response */ {
  data?: object;
};
export type HarnessAbortArgs = {
  id: string;
  body: {
    reason: string;
  };
};
export type HarnessResolveInterruptedRes = /** status 200 Successful response */ {
  data?: object;
};
export type HarnessResolveInterruptedArgs = {
  id: string;
  body: {
    action: "abort" | "complete" | "retry";
    reason: string;
    result?: any | null;
  };
};
export type GetHarnessTasksByIdRes = /** status 200 Successful read */ {
  abortRequested?: {
    /** When an abort of this task was requested */
    at?: string;
    /** Until when one aborter holds the right to run the abort handler */
    handlerClaimExpiresAt?: string;
    /** Why the abort was requested */
    reason?: string;
    /** Who requested the abort */
    userId?: string;
  };
  /** Owning tasks from the root down to the parent (empty for a root task); scopes task event streams to a subtree */
  ancestorIds?: string[];
  /** Failed attempts consumed by the current phase */
  attempt?: number;
  /** When true, the task outlives its owning conversation turn */
  background?: boolean;
  /** Events received by harness.sendEvent; numbers the task's inbox */
  eventSeq?: number;
  /** Immutable task input */
  input?: any;
  lease?: {
    /** When the current phase started under this lease */
    acquiredAt?: string;
    /** When the current execution lease lapses */
    expiresAt?: string;
    /** Runner instance that holds the execution lease */
    owner?: string;
    /** Fencing token every commit must match */
    token?: string;
  };
  /** Registered task definition name */
  name: string;
  outcome?: {
    /** Failure cause for a failed task */
    error?: string;
    /** Result value for a completed task */
    result?: any;
    /** Terminal status recorded with the outcome */
    status?: "aborted" | "completed" | "failed";
  };
  ownership?: {
    /** Owning conversation or task id; empty for root tasks */
    id?: string;
    /** What owns this task: a conversation, another task, or nothing (root) */
    kind?: "conversation" | "root" | "task";
  };
  /** Current checkpointed phase name */
  phase: string;
  /** Caller idempotency key; a repeated create returns the existing task */
  requestId?: string;
  retry?: {
    /** Base retry backoff in milliseconds */
    backoffMs?: number;
    /** Attempts allowed per phase before the task fails */
    maxAttempts?: number;
    /** Upper bound for retry backoff in milliseconds */
    maxBackoffMs?: number;
  };
  /** Root CHAIN span that parents every phase span */
  rootSpanId: string;
  /** Top of the ownership tree; equals _id for root tasks */
  rootTaskId: string;
  /** Earliest time a runner may execute the task */
  runAt?: string;
  /** Checkpointed task state */
  state?: any;
  /** Lifecycle status of the task */
  status: "aborted" | "completed" | "failed" | "interrupted" | "pending" | "running" | "waiting";
  /** Phase commits so far; names the current phase visit for idempotent child creation */
  step?: number;
  /** ObsTrace that audits this task tree */
  traceId: string;
  /** User on whose behalf the task runs */
  userId?: string;
  /** Pinned task definition version */
  version: number;
  waiting?: {
    /** Event key or sleep reason the task waits on */
    key?: string;
    /** What the task waits for */
    kind?: "event" | "sleep" | "tasks";
    /** How child-task waits resolve */
    policy?: "all" | "failFast";
    /** Child tasks the task waits on */
    taskIds?: string[];
    /** When the wait times out */
    timeoutAt?: string;
  };
  /** rt.waitFor / rt.sleep calls of the current phase visit by `<step>:<call index>`, so a re-run returns the same result */
  waits?: any;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetHarnessTasksByIdArgs = string;
export type HarnessApproveRes = /** status 200 Successful response */ {
  data?: object;
};
export type HarnessApproveArgs = {
  id: string;
  body: {
    reason?: string;
  };
};
export type HarnessRejectRes = /** status 200 Successful response */ {
  data?: object;
};
export type HarnessRejectArgs = {
  id: string;
  body: {
    reason: string;
  };
};
export type GetHarnessApprovalsRes = /** status 200 Successful list */ {
  data?: {
    /** `<step>:<call index>` of the wait call that requested the approval */
    callKey: string;
    /** When the approval was approved or rejected */
    decidedAt?: string;
    /** User who approved or rejected the approval */
    decidedBy?: string;
    /** `name@version:key` of the requesting task definition and approval key */
    definitionKey: string;
    /** Inbox event name the decision sends to the waiting task */
    event: string;
    /** When the approval expires undecided; unset means it never expires */
    expiresAt?: string;
    /** Extension whose approvals policy names the approvers (hook approvals only) */
    extension?: string;
    /** Approval key; selects the approvers policy of the definition or extension */
    key: string;
    /** What the approver reviews (JSON) */
    payload?: any;
    /** Why the approver approved or rejected */
    reason?: string;
    /** Root task of the requesting task's ownership tree */
    rootTaskId: string;
    /** pending until approved, rejected, or expired */
    status: "approved" | "expired" | "pending" | "rejected";
    /** Short explanation shown under the title */
    summary?: string;
    /** Task that requested the approval and waits for the decision */
    taskId: string;
    /** What the approver is asked to approve */
    title: string;
    /** ObsTrace of the requesting task; the decision span lands in it */
    traceId: string;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetHarnessApprovalsArgs = {
  _id?: {
    $in?: string[];
  };
  rootTaskId?:
    | any
    | {
        $in?: any[];
      };
  taskId?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetHarnessApprovalsByIdRes = /** status 200 Successful read */ {
  /** `<step>:<call index>` of the wait call that requested the approval */
  callKey: string;
  /** When the approval was approved or rejected */
  decidedAt?: string;
  /** User who approved or rejected the approval */
  decidedBy?: string;
  /** `name@version:key` of the requesting task definition and approval key */
  definitionKey: string;
  /** Inbox event name the decision sends to the waiting task */
  event: string;
  /** When the approval expires undecided; unset means it never expires */
  expiresAt?: string;
  /** Extension whose approvals policy names the approvers (hook approvals only) */
  extension?: string;
  /** Approval key; selects the approvers policy of the definition or extension */
  key: string;
  /** What the approver reviews (JSON) */
  payload?: any;
  /** Why the approver approved or rejected */
  reason?: string;
  /** Root task of the requesting task's ownership tree */
  rootTaskId: string;
  /** pending until approved, rejected, or expired */
  status: "approved" | "expired" | "pending" | "rejected";
  /** Short explanation shown under the title */
  summary?: string;
  /** Task that requested the approval and waits for the decision */
  taskId: string;
  /** What the approver is asked to approve */
  title: string;
  /** ObsTrace of the requesting task; the decision span lands in it */
  traceId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
};
export type GetHarnessApprovalsByIdArgs = string;
export type GetAdminConfigRes = /** status 200 Success */ {
  capabilities?: {
    actions?: boolean;
    fieldsets?: boolean;
    filters?: boolean;
    realtime?: boolean;
  };
  customScreens?: {
    description?: string;
    displayName?: string;
    group?: string;
    icon?: string;
    name?: string;
  }[];
  home?: object;
  models?: any;
  platformTools?: {
    configuration?: boolean;
    roles?: boolean;
    runScripts?: boolean;
    scripts?: boolean;
    version?: boolean;
    viewScripts?: boolean;
  };
  schemaVersion?: number;
  scripts?: {
    args?: any;
    description?: string;
    name?: string;
  }[];
  widgetIds?: string[];
};
export type GetAdminConfigArgs = undefined;
export type PostAdminBackgroundTasksRes = /** status 201 Success */ {
  taskId?: string;
};
export type PostAdminBackgroundTasksArgs = {
  /** Optional target document ids */
  ids?: string[];
  /** Task kind label persisted as taskType */
  kind: string;
  /** Opaque JSON metadata for workers */
  metadata?: object;
  /** Optional admin model route this task relates to */
  resourceRoute?: string;
};
export type PostAdminMcpServiceTokensBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminMcpServiceTokensBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminMcpServiceTokensRes = /** status 200 Successful list */ {
  data?: {
    /** When this MCP service token expires; unset when it does not expire */
    expiresAt?: string;
    /** When this MCP service token most recently authenticated an MCP request */
    lastUsedAt?: string;
    /** User-provided label identifying the MCP service token */
    name: string;
    /** When this MCP service token was revoked; unset while it remains active */
    revokedAt?: string;
    /** SHA-256 hash of the full MCP service token plaintext */
    tokenHash: string;
    /** First eight characters after mcp_ used to identify the token safely */
    tokenPrefix: string;
    /** The user this MCP service token acts as */
    userId: string;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminMcpServiceTokensArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  name?:
    | string
    | {
        $in?: string[];
      };
  tokenPrefix?:
    | string
    | {
        $in?: string[];
      };
  userId?:
    | any
    | {
        $in?: any[];
      };
  lastUsedAt?:
    | string
    | {
        /** When this MCP service token most recently authenticated an MCP request */
        $gt?: string;
        /** When this MCP service token most recently authenticated an MCP request */
        $gte?: string;
        /** When this MCP service token most recently authenticated an MCP request */
        $lt?: string;
        /** When this MCP service token most recently authenticated an MCP request */
        $lte?: string;
      };
  expiresAt?:
    | string
    | {
        /** When this MCP service token expires; unset when it does not expire */
        $gt?: string;
        /** When this MCP service token expires; unset when it does not expire */
        $gte?: string;
        /** When this MCP service token expires; unset when it does not expire */
        $lt?: string;
        /** When this MCP service token expires; unset when it does not expire */
        $lte?: string;
      };
  revokedAt?:
    | string
    | {
        /** When this MCP service token was revoked; unset while it remains active */
        $gt?: string;
        /** When this MCP service token was revoked; unset while it remains active */
        $gte?: string;
        /** When this MCP service token was revoked; unset while it remains active */
        $lt?: string;
        /** When this MCP service token was revoked; unset while it remains active */
        $lte?: string;
      };
  created?:
    | string
    | {
        /** When this document was created */
        $gt?: string;
        /** When this document was created */
        $gte?: string;
        /** When this document was created */
        $lt?: string;
        /** When this document was created */
        $lte?: string;
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminMcpServiceTokensByIdRes = /** status 200 Successful read */ {
  /** When this MCP service token expires; unset when it does not expire */
  expiresAt?: string;
  /** When this MCP service token most recently authenticated an MCP request */
  lastUsedAt?: string;
  /** User-provided label identifying the MCP service token */
  name: string;
  /** When this MCP service token was revoked; unset while it remains active */
  revokedAt?: string;
  /** SHA-256 hash of the full MCP service token plaintext */
  tokenHash: string;
  /** First eight characters after mcp_ used to identify the token safely */
  tokenPrefix: string;
  /** The user this MCP service token acts as */
  userId: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
};
export type GetAdminMcpServiceTokensByIdArgs = string;
export type DeleteAdminMcpServiceTokensByIdRes = unknown;
export type DeleteAdminMcpServiceTokensByIdArgs = string;
export type PostAdminFeatureFlagsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminFeatureFlagsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type PostAdminFeatureFlagsRes = /** status 201 Successful create */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostAdminFeatureFlagsArgs = {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key?: string;
  /** Human-readable display name */
  name?: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminFeatureFlagsRes = /** status 200 Successful list */ {
  data?: {
    /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
    archived?: boolean;
    /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
    defaultVariant?: string;
    /** Explanation of what this flag controls */
    description?: string;
    /** Global kill switch — if false, flag is off for everyone */
    enabled?: boolean;
    /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
    key: string;
    /** Human-readable display name */
    name: string;
    /** For boolean flags with no matching rules: percentage of users who get true */
    rolloutPercentage?: number;
    rules?: {
      /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
      enabled?: boolean;
      /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
      field?: string;
      /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
      operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
      /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
      segment?: string;
      /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
      value?: any;
      /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
      variant?: string;
      _id?: string;
    }[];
    /** Boolean toggle or multi-variant A/B test */
    type?: "boolean" | "variant";
    variants?: {
      /** Variant identifier, e.g., 'control', 'variant-a' */
      key: string;
      /** Percentage weight for assignment (0-100, all must sum to 100) */
      weight: number;
      _id?: string;
    }[];
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminFeatureFlagsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  key?:
    | string
    | {
        $in?: string[];
      };
  name?:
    | string
    | {
        $in?: string[];
      };
  type?:
    | ("boolean" | "variant")
    | {
        $in?: string[];
      };
  enabled?:
    | boolean
    | {
        $in?: boolean[];
      };
  archived?:
    | boolean
    | {
        $in?: boolean[];
      };
  defaultVariant?:
    | string
    | {
        $in?: string[];
      };
  created?:
    | string
    | {
        /** When this document was created */
        $gt?: string;
        /** When this document was created */
        $gte?: string;
        /** When this document was created */
        $lt?: string;
        /** When this document was created */
        $lte?: string;
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminFeatureFlagsByIdRes = /** status 200 Successful read */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminFeatureFlagsByIdArgs = string;
export type PatchAdminFeatureFlagsByIdRes = /** status 200 Successful update */ {
  /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
  archived?: boolean;
  /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
  defaultVariant?: string;
  /** Explanation of what this flag controls */
  description?: string;
  /** Global kill switch — if false, flag is off for everyone */
  enabled?: boolean;
  /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
  key: string;
  /** Human-readable display name */
  name: string;
  /** For boolean flags with no matching rules: percentage of users who get true */
  rolloutPercentage?: number;
  rules?: {
    /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
    enabled?: boolean;
    /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
    field?: string;
    /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
    operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
    /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
    segment?: string;
    /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
    value?: any;
    /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
    variant?: string;
    _id?: string;
  }[];
  /** Boolean toggle or multi-variant A/B test */
  type?: "boolean" | "variant";
  variants?: {
    /** Variant identifier, e.g., 'control', 'variant-a' */
    key: string;
    /** Percentage weight for assignment (0-100, all must sum to 100) */
    weight: number;
    _id?: string;
  }[];
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchAdminFeatureFlagsByIdArgs = {
  id: string;
  body: {
    /** Archived flags are excluded from evaluation. Use this instead of deleting flags to prevent bloat as new features are added. */
    archived?: boolean;
    /** OpenFeature defaultVariant key. Returned when the flag is disabled or errors during evaluation. For boolean flags, must be 'on' or 'off'. For variant flags, must be one of the keys in `variants`. Auto-populated on save when omitted (boolean → 'off', variant → first variant key). */
    defaultVariant?: string;
    /** Explanation of what this flag controls */
    description?: string;
    /** Global kill switch — if false, flag is off for everyone */
    enabled?: boolean;
    /** Unique identifier for the flag, e.g., 'new-checkout-flow' */
    key?: string;
    /** Human-readable display name */
    name?: string;
    /** For boolean flags with no matching rules: percentage of users who get true */
    rolloutPercentage?: number;
    rules?: {
      /** Whether the flag/variant is turned on when this rule matches. For boolean flags this is the override value; for variant flags it gates whether the forced variant applies. */
      enabled?: boolean;
      /** User field to match against (use with operator + value). Supports dot notation, e.g., 'email', 'admin', 'address.zip'. Use field/operator/value together, OR segment alone. */
      field?: string;
      /** Comparison operator for field-based rules (use with field + value). Use field/operator/value together, OR segment alone. */
      operator?: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "contains";
      /** Name of a registered segment function, e.g., 'pro-users'. Use segment alone, OR field/operator/value together. */
      segment?: string;
      /** Value to compare against (use with field + operator). String, number, boolean, or array for in/nin. Use field/operator/value together, OR segment alone. */
      value?: any;
      /** For variant flags only: forced variant key when this rule matches. Use field/operator/value together, OR segment alone. */
      variant?: string;
      _id?: string;
    }[];
    /** Boolean toggle or multi-variant A/B test */
    type?: "boolean" | "variant";
    variants?: {
      /** Variant identifier, e.g., 'control', 'variant-a' */
      key: string;
      /** Percentage weight for assignment (0-100, all must sum to 100) */
      weight: number;
      _id?: string;
    }[];
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteAdminFeatureFlagsByIdRes = unknown;
export type DeleteAdminFeatureFlagsByIdArgs = string;
export type PostAdminAuditEventsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminAuditEventsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminAuditEventsRes = /** status 200 Successful list */ {
  data?: {
    /** User who performed the mutation, when known */
    actorId?: string;
    /** Redacted changed fields after the mutation */
    after?: any;
    /** Redacted changed fields before the mutation */
    before?: any;
    /** Mongoose model name of the affected document */
    modelName: string;
    /** Fine-grained mutation kind */
    operation: "arrayPush" | "arrayRemove" | "arrayUpdate" | "create" | "delete" | "update";
    /** Tenant organization id when known */
    organizationId?: string;
    /** Primary key of the affected document */
    recordId?: string;
    /** Short human-readable label for the affected record */
    recordLabel?: string;
    /** Which framework surface wrote this event */
    source: "admin" | "modelRouter" | "rbac";
    /** Widget-compatible mutation verb */
    verb: "created" | "deleted" | "updated";
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminAuditEventsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  created?:
    | string
    | {
        /** When this document was created */
        $gt?: string;
        /** When this document was created */
        $gte?: string;
        /** When this document was created */
        $lt?: string;
        /** When this document was created */
        $lte?: string;
      };
  verb?:
    | ("created" | "deleted" | "updated")
    | {
        $in?: string[];
      };
  modelName?:
    | string
    | {
        $in?: string[];
      };
  recordLabel?:
    | string
    | {
        $in?: string[];
      };
  actorId?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminAuditEventsByIdRes = /** status 200 Successful read */ {
  /** User who performed the mutation, when known */
  actorId?: string;
  /** Redacted changed fields after the mutation */
  after?: any;
  /** Redacted changed fields before the mutation */
  before?: any;
  /** Mongoose model name of the affected document */
  modelName: string;
  /** Fine-grained mutation kind */
  operation: "arrayPush" | "arrayRemove" | "arrayUpdate" | "create" | "delete" | "update";
  /** Tenant organization id when known */
  organizationId?: string;
  /** Primary key of the affected document */
  recordId?: string;
  /** Short human-readable label for the affected record */
  recordLabel?: string;
  /** Which framework surface wrote this event */
  source: "admin" | "modelRouter" | "rbac";
  /** Widget-compatible mutation verb */
  verb: "created" | "deleted" | "updated";
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
};
export type GetAdminAuditEventsByIdArgs = string;
export type PostAdminConsentFormsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminConsentFormsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type PostAdminConsentFormsRes = /** status 201 Successful create */ {
  /** Whether this consent form is currently active and available to users */
  active?: boolean;
  /** Label text for the agreement button */
  agreeButtonText?: string;
  /** Whether users are allowed to decline the consent form */
  allowDecline?: boolean;
  /** Whether to require a drawn or typed signature when the user agrees */
  captureSignature?: boolean;
  /** List of checkboxes the user must interact with before agreeing */
  checkboxes?: {
    /** Optional prompt shown when the user checks this checkbox */
    confirmationPrompt?: string;
    /** Display label for the checkbox */
    label: string;
    /** Whether this checkbox must be checked before the user can agree */
    required?: boolean;
    _id?: string;
  }[];
  /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
  content: {
    [key: string]: string;
  };
  /** Label text for the decline button (only shown when allowDecline is true) */
  declineButtonText?: string;
  /** Default locale to use when the requested locale is not available */
  defaultLocale?: string;
  /** Display order relative to other consent forms (lower numbers appear first) */
  order: number;
  /** Whether users must complete this form before accessing the application */
  required?: boolean;
  /** Whether users must scroll to the bottom of the form content before agreeing */
  requireScrollToBottom?: boolean;
  /** URL-safe identifier for this form, combined with version to uniquely identify a form */
  slug: string;
  /** Human-readable title of the consent form */
  title: string;
  /** Category of consent form */
  type: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
  /** Version number of this form. Incrementing the version requires users to re-consent */
  version: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostAdminConsentFormsArgs = {
  /** Whether this consent form is currently active and available to users */
  active?: boolean;
  /** Label text for the agreement button */
  agreeButtonText?: string;
  /** Whether users are allowed to decline the consent form */
  allowDecline?: boolean;
  /** Whether to require a drawn or typed signature when the user agrees */
  captureSignature?: boolean;
  /** List of checkboxes the user must interact with before agreeing */
  checkboxes?: {
    /** Optional prompt shown when the user checks this checkbox */
    confirmationPrompt?: string;
    /** Display label for the checkbox */
    label: string;
    /** Whether this checkbox must be checked before the user can agree */
    required?: boolean;
    _id?: string;
  }[];
  /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
  content?: {
    [key: string]: string;
  };
  /** Label text for the decline button (only shown when allowDecline is true) */
  declineButtonText?: string;
  /** Default locale to use when the requested locale is not available */
  defaultLocale?: string;
  /** Display order relative to other consent forms (lower numbers appear first) */
  order?: number;
  /** Whether users must complete this form before accessing the application */
  required?: boolean;
  /** Whether users must scroll to the bottom of the form content before agreeing */
  requireScrollToBottom?: boolean;
  /** URL-safe identifier for this form, combined with version to uniquely identify a form */
  slug?: string;
  /** Human-readable title of the consent form */
  title?: string;
  /** Category of consent form */
  type?: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
  /** Version number of this form. Incrementing the version requires users to re-consent */
  version?: number;
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminConsentFormsRes = /** status 200 Successful list */ {
  data?: {
    /** Whether this consent form is currently active and available to users */
    active?: boolean;
    /** Label text for the agreement button */
    agreeButtonText?: string;
    /** Whether users are allowed to decline the consent form */
    allowDecline?: boolean;
    /** Whether to require a drawn or typed signature when the user agrees */
    captureSignature?: boolean;
    /** List of checkboxes the user must interact with before agreeing */
    checkboxes?: {
      /** Optional prompt shown when the user checks this checkbox */
      confirmationPrompt?: string;
      /** Display label for the checkbox */
      label: string;
      /** Whether this checkbox must be checked before the user can agree */
      required?: boolean;
      _id?: string;
    }[];
    /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
    content: {
      [key: string]: string;
    };
    /** Label text for the decline button (only shown when allowDecline is true) */
    declineButtonText?: string;
    /** Default locale to use when the requested locale is not available */
    defaultLocale?: string;
    /** Display order relative to other consent forms (lower numbers appear first) */
    order: number;
    /** Whether users must complete this form before accessing the application */
    required?: boolean;
    /** Whether users must scroll to the bottom of the form content before agreeing */
    requireScrollToBottom?: boolean;
    /** URL-safe identifier for this form, combined with version to uniquely identify a form */
    slug: string;
    /** Human-readable title of the consent form */
    title: string;
    /** Category of consent form */
    type: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
    /** Version number of this form. Incrementing the version requires users to re-consent */
    version: number;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminConsentFormsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  title?:
    | string
    | {
        $in?: string[];
      };
  type?:
    | ("agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom")
    | {
        $in?: string[];
      };
  version?:
    | number
    | {
        /** Version number of this form. Incrementing the version requires users to re-consent */
        $gt?: number;
        /** Version number of this form. Incrementing the version requires users to re-consent */
        $gte?: number;
        /** Version number of this form. Incrementing the version requires users to re-consent */
        $lt?: number;
        /** Version number of this form. Incrementing the version requires users to re-consent */
        $lte?: number;
      };
  active?:
    | boolean
    | {
        $in?: boolean[];
      };
  order?:
    | number
    | {
        /** Display order relative to other consent forms (lower numbers appear first) */
        $gt?: number;
        /** Display order relative to other consent forms (lower numbers appear first) */
        $gte?: number;
        /** Display order relative to other consent forms (lower numbers appear first) */
        $lt?: number;
        /** Display order relative to other consent forms (lower numbers appear first) */
        $lte?: number;
      };
  slug?:
    | string
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminConsentFormsByIdRes = /** status 200 Successful read */ {
  /** Whether this consent form is currently active and available to users */
  active?: boolean;
  /** Label text for the agreement button */
  agreeButtonText?: string;
  /** Whether users are allowed to decline the consent form */
  allowDecline?: boolean;
  /** Whether to require a drawn or typed signature when the user agrees */
  captureSignature?: boolean;
  /** List of checkboxes the user must interact with before agreeing */
  checkboxes?: {
    /** Optional prompt shown when the user checks this checkbox */
    confirmationPrompt?: string;
    /** Display label for the checkbox */
    label: string;
    /** Whether this checkbox must be checked before the user can agree */
    required?: boolean;
    _id?: string;
  }[];
  /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
  content: {
    [key: string]: string;
  };
  /** Label text for the decline button (only shown when allowDecline is true) */
  declineButtonText?: string;
  /** Default locale to use when the requested locale is not available */
  defaultLocale?: string;
  /** Display order relative to other consent forms (lower numbers appear first) */
  order: number;
  /** Whether users must complete this form before accessing the application */
  required?: boolean;
  /** Whether users must scroll to the bottom of the form content before agreeing */
  requireScrollToBottom?: boolean;
  /** URL-safe identifier for this form, combined with version to uniquely identify a form */
  slug: string;
  /** Human-readable title of the consent form */
  title: string;
  /** Category of consent form */
  type: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
  /** Version number of this form. Incrementing the version requires users to re-consent */
  version: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminConsentFormsByIdArgs = string;
export type PatchAdminConsentFormsByIdRes = /** status 200 Successful update */ {
  /** Whether this consent form is currently active and available to users */
  active?: boolean;
  /** Label text for the agreement button */
  agreeButtonText?: string;
  /** Whether users are allowed to decline the consent form */
  allowDecline?: boolean;
  /** Whether to require a drawn or typed signature when the user agrees */
  captureSignature?: boolean;
  /** List of checkboxes the user must interact with before agreeing */
  checkboxes?: {
    /** Optional prompt shown when the user checks this checkbox */
    confirmationPrompt?: string;
    /** Display label for the checkbox */
    label: string;
    /** Whether this checkbox must be checked before the user can agree */
    required?: boolean;
    _id?: string;
  }[];
  /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
  content: {
    [key: string]: string;
  };
  /** Label text for the decline button (only shown when allowDecline is true) */
  declineButtonText?: string;
  /** Default locale to use when the requested locale is not available */
  defaultLocale?: string;
  /** Display order relative to other consent forms (lower numbers appear first) */
  order: number;
  /** Whether users must complete this form before accessing the application */
  required?: boolean;
  /** Whether users must scroll to the bottom of the form content before agreeing */
  requireScrollToBottom?: boolean;
  /** URL-safe identifier for this form, combined with version to uniquely identify a form */
  slug: string;
  /** Human-readable title of the consent form */
  title: string;
  /** Category of consent form */
  type: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
  /** Version number of this form. Incrementing the version requires users to re-consent */
  version: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchAdminConsentFormsByIdArgs = {
  id: string;
  body: {
    /** Whether this consent form is currently active and available to users */
    active?: boolean;
    /** Label text for the agreement button */
    agreeButtonText?: string;
    /** Whether users are allowed to decline the consent form */
    allowDecline?: boolean;
    /** Whether to require a drawn or typed signature when the user agrees */
    captureSignature?: boolean;
    /** List of checkboxes the user must interact with before agreeing */
    checkboxes?: {
      /** Optional prompt shown when the user checks this checkbox */
      confirmationPrompt?: string;
      /** Display label for the checkbox */
      label: string;
      /** Whether this checkbox must be checked before the user can agree */
      required?: boolean;
      _id?: string;
    }[];
    /** Locale-keyed map of Markdown content for this form (e.g. {"en": "# Terms\n..."}) */
    content?: {
      [key: string]: string;
    };
    /** Label text for the decline button (only shown when allowDecline is true) */
    declineButtonText?: string;
    /** Default locale to use when the requested locale is not available */
    defaultLocale?: string;
    /** Display order relative to other consent forms (lower numbers appear first) */
    order?: number;
    /** Whether users must complete this form before accessing the application */
    required?: boolean;
    /** Whether users must scroll to the bottom of the form content before agreeing */
    requireScrollToBottom?: boolean;
    /** URL-safe identifier for this form, combined with version to uniquely identify a form */
    slug?: string;
    /** Human-readable title of the consent form */
    title?: string;
    /** Category of consent form */
    type?: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
    /** Version number of this form. Incrementing the version requires users to re-consent */
    version?: number;
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteAdminConsentFormsByIdRes = unknown;
export type DeleteAdminConsentFormsByIdArgs = string;
export type PostAdminConsentResponsesBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminConsentResponsesBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminConsentResponsesRes = /** status 200 Successful list */ {
  data?: {
    /** Whether the user agreed (true) or declined (false) the consent form */
    agreed: boolean;
    /** Timestamp when the user submitted their agreement or declination */
    agreedAt: string;
    /** Map of checkbox index to boolean indicating whether each checkbox was checked */
    checkboxValues?: {
      [key: string]: boolean;
    };
    consentFormId: {
      /** Human-readable title of the consent form */
      title?: string;
      /** URL-safe identifier for this form, combined with version to uniquely identify a form */
      slug?: string;
      /** Version number of this form. Incrementing the version requires users to re-consent */
      version?: number;
      /** Category of consent form */
      type?: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
    };
    /** Snapshot of the form content in the user's locale at the time of response */
    contentSnapshot?: string;
    /** Version number of the form at the time the user responded */
    formVersionSnapshot?: number;
    /** IP address of the user at the time of response, captured for audit purposes */
    ipAddress?: string;
    /** Locale code of the content version the user viewed when responding */
    locale: string;
    /** Base64-encoded signature image or typed signature text, if captured */
    signature?: string;
    /** Timestamp when the user provided their signature */
    signedAt?: string;
    /** User-agent string of the browser or app used to submit the response */
    userAgent?: string;
    userId: {
      /** The user's display name */
      name?: string;
      /** The user's email address, used for authentication */
      email?: string;
    };
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminConsentResponsesArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  userId?:
    | any
    | {
        $in?: any[];
      };
  agreed?:
    | boolean
    | {
        $in?: boolean[];
      };
  locale?:
    | string
    | {
        $in?: string[];
      };
  agreedAt?:
    | string
    | {
        /** Timestamp when the user submitted their agreement or declination */
        $gt?: string;
        /** Timestamp when the user submitted their agreement or declination */
        $gte?: string;
        /** Timestamp when the user submitted their agreement or declination */
        $lt?: string;
        /** Timestamp when the user submitted their agreement or declination */
        $lte?: string;
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminConsentResponsesByIdRes = /** status 200 Successful read */ {
  /** Whether the user agreed (true) or declined (false) the consent form */
  agreed: boolean;
  /** Timestamp when the user submitted their agreement or declination */
  agreedAt: string;
  /** Map of checkbox index to boolean indicating whether each checkbox was checked */
  checkboxValues?: {
    [key: string]: boolean;
  };
  consentFormId: {
    /** Human-readable title of the consent form */
    title?: string;
    /** URL-safe identifier for this form, combined with version to uniquely identify a form */
    slug?: string;
    /** Version number of this form. Incrementing the version requires users to re-consent */
    version?: number;
    /** Category of consent form */
    type?: "agreement" | "privacy" | "hipaa" | "research" | "terms" | "custom";
  };
  /** Snapshot of the form content in the user's locale at the time of response */
  contentSnapshot?: string;
  /** Version number of the form at the time the user responded */
  formVersionSnapshot?: number;
  /** IP address of the user at the time of response, captured for audit purposes */
  ipAddress?: string;
  /** Locale code of the content version the user viewed when responding */
  locale: string;
  /** Base64-encoded signature image or typed signature text, if captured */
  signature?: string;
  /** Timestamp when the user provided their signature */
  signedAt?: string;
  /** User-agent string of the browser or app used to submit the response */
  userAgent?: string;
  userId: {
    /** The user's display name */
    name?: string;
    /** The user's email address, used for authentication */
    email?: string;
  };
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminConsentResponsesByIdArgs = string;
export type PostAdminAnnouncementsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminAnnouncementsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type PostAdminAnnouncementsRes = /** status 201 Successful create */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostAdminAnnouncementsArgs = {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body?: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status?: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title?: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminAnnouncementsRes = /** status 200 Successful list */ {
  data?: {
    /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
    acknowledgementPolicy?: "required" | "dismiss-only";
    /** When the announcement was archived */
    archivedAt?: string;
    /** Opaque targeting metadata consumed by matchAudience callback */
    audience?: any;
    /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
    audienceType?: "staff" | "patient" | "all";
    /** Markdown body shown in the announcement modal */
    body: string;
    /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
    displayMode?: "modal" | "banner" | "feed";
    /** Optional expiry — hidden from pending/feed after this time */
    expiresAt?: string;
    /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
    minBuildNumber?: number;
    /** Platforms that should receive this announcement */
    platforms?: ("ios" | "android" | "web")[];
    primaryAction?: {
      /** Button label for optional primary action */
      label?: string;
      /** Deep link or external URL opened by the primary action button */
      url?: string;
    };
    /** Higher priority announcements appear first in the modal queue */
    priority?: number;
    /** Optional scheduled publish time — hidden until this instant */
    publishAt?: string;
    /** When the announcement was first published */
    publishedAt?: string;
    release?: {
      /** Client build number associated with the imported product release */
      buildNumber?: number;
      /** Release channel associated with the imported announcement */
      channel?: string;
      /** Product identifier associated with the imported announcement */
      product?: string;
      /** User-facing product version associated with the imported announcement */
      version?: string;
    };
    /** Stable announcement identifier within an imported product release */
    releaseSlug?: string;
    /** Lifecycle status: draft, published, or archived */
    status: "draft" | "published" | "archived";
    /** Announcement title shown in modal and changelog feed */
    title: string;
    /** Content version — increments when published title/body changes */
    version?: number;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminAnnouncementsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  title?:
    | string
    | {
        $in?: string[];
      };
  status?:
    | ("draft" | "published" | "archived")
    | {
        $in?: string[];
      };
  priority?:
    | number
    | {
        /** Higher priority announcements appear first in the modal queue */
        $gt?: number;
        /** Higher priority announcements appear first in the modal queue */
        $gte?: number;
        /** Higher priority announcements appear first in the modal queue */
        $lt?: number;
        /** Higher priority announcements appear first in the modal queue */
        $lte?: number;
      };
  version?:
    | number
    | {
        /** Content version — increments when published title/body changes */
        $gt?: number;
        /** Content version — increments when published title/body changes */
        $gte?: number;
        /** Content version — increments when published title/body changes */
        $lt?: number;
        /** Content version — increments when published title/body changes */
        $lte?: number;
      };
  publishedAt?:
    | string
    | {
        /** When the announcement was first published */
        $gt?: string;
        /** When the announcement was first published */
        $gte?: string;
        /** When the announcement was first published */
        $lt?: string;
        /** When the announcement was first published */
        $lte?: string;
      };
  expiresAt?:
    | string
    | {
        /** Optional expiry — hidden from pending/feed after this time */
        $gt?: string;
        /** Optional expiry — hidden from pending/feed after this time */
        $gte?: string;
        /** Optional expiry — hidden from pending/feed after this time */
        $lt?: string;
        /** Optional expiry — hidden from pending/feed after this time */
        $lte?: string;
      };
  acknowledgementPolicy?:
    | ("required" | "dismiss-only")
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminAnnouncementsByIdRes = /** status 200 Successful read */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminAnnouncementsByIdArgs = string;
export type PatchAdminAnnouncementsByIdRes = /** status 200 Successful update */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchAdminAnnouncementsByIdArgs = {
  id: string;
  body: {
    /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
    acknowledgementPolicy?: "required" | "dismiss-only";
    /** When the announcement was archived */
    archivedAt?: string;
    /** Opaque targeting metadata consumed by matchAudience callback */
    audience?: any;
    /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
    audienceType?: "staff" | "patient" | "all";
    /** Markdown body shown in the announcement modal */
    body?: string;
    /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
    displayMode?: "modal" | "banner" | "feed";
    /** Optional expiry — hidden from pending/feed after this time */
    expiresAt?: string;
    /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
    minBuildNumber?: number;
    /** Platforms that should receive this announcement */
    platforms?: ("ios" | "android" | "web")[];
    primaryAction?: {
      /** Button label for optional primary action */
      label?: string;
      /** Deep link or external URL opened by the primary action button */
      url?: string;
    };
    /** Higher priority announcements appear first in the modal queue */
    priority?: number;
    /** Optional scheduled publish time — hidden until this instant */
    publishAt?: string;
    /** When the announcement was first published */
    publishedAt?: string;
    release?: {
      /** Client build number associated with the imported product release */
      buildNumber?: number;
      /** Release channel associated with the imported announcement */
      channel?: string;
      /** Product identifier associated with the imported announcement */
      product?: string;
      /** User-facing product version associated with the imported announcement */
      version?: string;
    };
    /** Stable announcement identifier within an imported product release */
    releaseSlug?: string;
    /** Lifecycle status: draft, published, or archived */
    status?: "draft" | "published" | "archived";
    /** Announcement title shown in modal and changelog feed */
    title?: string;
    /** Content version — increments when published title/body changes */
    version?: number;
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteAdminAnnouncementsByIdRes = unknown;
export type DeleteAdminAnnouncementsByIdArgs = string;
export type PostAdminAnnouncementAcknowledgementsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminAnnouncementAcknowledgementsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminAnnouncementAcknowledgementsRes = /** status 200 Successful list */ {
  data?: {
    /** When the user acknowledged this announcement version */
    acknowledgedAt: string;
    /** Announcement that was acknowledged */
    announcementId: string;
    /** User who acknowledged the announcement */
    userId: string;
    /** Announcement version acknowledged by the user */
    version: number;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminAnnouncementAcknowledgementsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  userId?:
    | any
    | {
        $in?: any[];
      };
  announcementId?:
    | any
    | {
        $in?: any[];
      };
  version?:
    | number
    | {
        /** Announcement version acknowledged by the user */
        $gt?: number;
        /** Announcement version acknowledged by the user */
        $gte?: number;
        /** Announcement version acknowledged by the user */
        $lt?: number;
        /** Announcement version acknowledged by the user */
        $lte?: number;
      };
  acknowledgedAt?:
    | string
    | {
        /** When the user acknowledged this announcement version */
        $gt?: string;
        /** When the user acknowledged this announcement version */
        $gte?: string;
        /** When the user acknowledged this announcement version */
        $lt?: string;
        /** When the user acknowledged this announcement version */
        $lte?: string;
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminAnnouncementAcknowledgementsByIdRes = /** status 200 Successful read */ {
  /** When the user acknowledged this announcement version */
  acknowledgedAt: string;
  /** Announcement that was acknowledged */
  announcementId: string;
  /** User who acknowledged the announcement */
  userId: string;
  /** Announcement version acknowledged by the user */
  version: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminAnnouncementAcknowledgementsByIdArgs = string;
export type PostAdminAnnouncementImpressionsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminAnnouncementImpressionsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminAnnouncementImpressionsRes = /** status 200 Successful list */ {
  data?: {
    /** Announcement that was viewed */
    announcementId: string;
    /** Client platform where the impression occurred */
    platform?: "ios" | "android" | "web";
    /** User who viewed the announcement */
    userId: string;
    /** Announcement version viewed by the user */
    version: number;
    /** When the announcement was viewed */
    viewedAt: string;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminAnnouncementImpressionsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  userId?:
    | any
    | {
        $in?: any[];
      };
  announcementId?:
    | any
    | {
        $in?: any[];
      };
  version?:
    | number
    | {
        /** Announcement version viewed by the user */
        $gt?: number;
        /** Announcement version viewed by the user */
        $gte?: number;
        /** Announcement version viewed by the user */
        $lt?: number;
        /** Announcement version viewed by the user */
        $lte?: number;
      };
  viewedAt?:
    | string
    | {
        /** When the announcement was viewed */
        $gt?: string;
        /** When the announcement was viewed */
        $gte?: string;
        /** When the announcement was viewed */
        $lt?: string;
        /** When the announcement was viewed */
        $lte?: string;
      };
  platform?:
    | ("ios" | "android" | "web")
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminAnnouncementImpressionsByIdRes = /** status 200 Successful read */ {
  /** Announcement that was viewed */
  announcementId: string;
  /** Client platform where the impression occurred */
  platform?: "ios" | "android" | "web";
  /** User who viewed the announcement */
  userId: string;
  /** Announcement version viewed by the user */
  version: number;
  /** When the announcement was viewed */
  viewedAt: string;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminAnnouncementImpressionsByIdArgs = string;
export type PostAdminAnnouncementClickEventsBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminAnnouncementClickEventsBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type GetAdminAnnouncementClickEventsRes = /** status 200 Successful list */ {
  data?: {
    /** Which announcement action the user clicked */
    action: "primaryAction";
    /** Announcement whose primary action was clicked */
    announcementId: string;
    /** When the primary action was clicked */
    clickedAt: string;
    /** Client platform where the click occurred */
    platform?: "ios" | "android" | "web";
    /** User who clicked the announcement action */
    userId: string;
    /** Announcement version at click time */
    version: number;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminAnnouncementClickEventsArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  userId?:
    | any
    | {
        $in?: any[];
      };
  announcementId?:
    | any
    | {
        $in?: any[];
      };
  version?:
    | number
    | {
        /** Announcement version at click time */
        $gt?: number;
        /** Announcement version at click time */
        $gte?: number;
        /** Announcement version at click time */
        $lt?: number;
        /** Announcement version at click time */
        $lte?: number;
      };
  action?:
    | "primaryAction"
    | {
        $in?: string[];
      };
  clickedAt?:
    | string
    | {
        /** When the primary action was clicked */
        $gt?: string;
        /** When the primary action was clicked */
        $gte?: string;
        /** When the primary action was clicked */
        $lt?: string;
        /** When the primary action was clicked */
        $lte?: string;
      };
  platform?:
    | ("ios" | "android" | "web")
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminAnnouncementClickEventsByIdRes = /** status 200 Successful read */ {
  /** Which announcement action the user clicked */
  action: "primaryAction";
  /** Announcement whose primary action was clicked */
  announcementId: string;
  /** When the primary action was clicked */
  clickedAt: string;
  /** Client platform where the click occurred */
  platform?: "ios" | "android" | "web";
  /** User who clicked the announcement action */
  userId: string;
  /** Announcement version at click time */
  version: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminAnnouncementClickEventsByIdArgs = string;
export type PostAdminTodosBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminTodosBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type PostAdminTodosRes = /** status 201 Successful create */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PostAdminTodosArgs = {
  /** The document id (String so offline sync clients can mint ids) */
  _id?: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId?: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetAdminTodosRes = /** status 200 Successful list */ {
  data?: {
    /** The document id (String so offline sync clients can mint ids) */
    _id: string;
    /** Whether the todo item has been completed */
    completed?: boolean;
    /** The user who owns this todo */
    ownerId: string;
    /** Priority level of the todo */
    priority?: "low" | "medium" | "high";
    /** Free-form tags for categorization */
    tags?: string[];
    /** The title of the todo item */
    title: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminTodosArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  title?:
    | string
    | {
        $in?: string[];
      };
  completed?:
    | boolean
    | {
        $in?: boolean[];
      };
  ownerId?:
    | any
    | {
        $in?: any[];
      };
  created?:
    | string
    | {
        /** When this document was created */
        $gt?: string;
        /** When this document was created */
        $gte?: string;
        /** When this document was created */
        $lt?: string;
        /** When this document was created */
        $lte?: string;
      };
  priority?:
    | ("low" | "medium" | "high")
    | {
        $in?: string[];
      };
  tags?:
    | string[]
    | {
        $in?: any[];
      };
  createdGte?:
    | any
    | {
        $in?: any[];
      };
  createdLte?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminTodosByIdRes = /** status 200 Successful read */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetAdminTodosByIdArgs = string;
export type PatchAdminTodosByIdRes = /** status 200 Successful update */ {
  /** The document id (String so offline sync clients can mint ids) */
  _id: string;
  /** Whether the todo item has been completed */
  completed?: boolean;
  /** The user who owns this todo */
  ownerId: string;
  /** Priority level of the todo */
  priority?: "low" | "medium" | "high";
  /** Free-form tags for categorization */
  tags?: string[];
  /** The title of the todo item */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PatchAdminTodosByIdArgs = {
  id: string;
  body: {
    /** The document id (String so offline sync clients can mint ids) */
    _id?: string;
    /** Whether the todo item has been completed */
    completed?: boolean;
    /** The user who owns this todo */
    ownerId?: string;
    /** Priority level of the todo */
    priority?: "low" | "medium" | "high";
    /** Free-form tags for categorization */
    tags?: string[];
    /** The title of the todo item */
    title?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  };
};
export type DeleteAdminTodosByIdRes = unknown;
export type DeleteAdminTodosByIdArgs = string;
export type PostAdminUsersBulkPatchRes = /** status 200 Success */ {
  failures?: any;
  updated?: number;
};
export type PostAdminUsersBulkPatchArgs = {
  /** Document ids to update */
  ids: string[];
  /** Partial document; keys must be allowlisted for this model */
  patch: object;
};
export type PostAdminUsersRes = /** status 201 Successful create */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostAdminUsersArgs = {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email?: string;
  /** The user's display name */
  name?: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id?: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminUsersRes = /** status 200 Successful list */ {
  data?: {
    /** Whether the user has admin privileges */
    admin?: boolean;
    /** Identifier linking to the Better Auth session provider */
    betterAuthId?: string;
    /** The user's email address, used for authentication */
    email: string;
    /** The user's display name */
    name: string;
    /** OAuth provider used for authentication */
    oauthProvider?: "google" | "github" | "apple" | null;
    /** Incremented on password reset to invalidate outstanding refresh tokens */
    tokenEpoch?: number;
    _id: string;
    hash?: string;
    salt?: string;
    /** RBAC role names assigned to this user */
    roles?: string[];
    /** Whether the user has verified their email address */
    emailVerified?: boolean;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAdminUsersArgs = {
  _id?: {
    $in?: string[];
  };
  q?:
    | any
    | {
        $in?: any[];
      };
  email?:
    | string
    | {
        $in?: string[];
      };
  name?:
    | string
    | {
        $in?: string[];
      };
  admin?:
    | boolean
    | {
        $in?: boolean[];
      };
  emailVerified?:
    | boolean
    | {
        $in?: boolean[];
      };
  created?:
    | string
    | {
        /** When this document was created */
        $gt?: string;
        /** When this document was created */
        $gte?: string;
        /** When this document was created */
        $lt?: string;
        /** When this document was created */
        $lte?: string;
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAdminUsersByIdRes = /** status 200 Successful read */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAdminUsersByIdArgs = string;
export type PatchAdminUsersByIdRes = /** status 200 Successful update */ {
  /** Whether the user has admin privileges */
  admin?: boolean;
  /** Identifier linking to the Better Auth session provider */
  betterAuthId?: string;
  /** The user's email address, used for authentication */
  email: string;
  /** The user's display name */
  name: string;
  /** OAuth provider used for authentication */
  oauthProvider?: "google" | "github" | "apple" | null;
  /** Incremented on password reset to invalidate outstanding refresh tokens */
  tokenEpoch?: number;
  _id: string;
  hash?: string;
  salt?: string;
  /** RBAC role names assigned to this user */
  roles?: string[];
  /** Whether the user has verified their email address */
  emailVerified?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchAdminUsersByIdArgs = {
  id: string;
  body: {
    /** Whether the user has admin privileges */
    admin?: boolean;
    /** Identifier linking to the Better Auth session provider */
    betterAuthId?: string;
    /** The user's email address, used for authentication */
    email?: string;
    /** The user's display name */
    name?: string;
    /** OAuth provider used for authentication */
    oauthProvider?: "google" | "github" | "apple" | null;
    /** Incremented on password reset to invalidate outstanding refresh tokens */
    tokenEpoch?: number;
    _id?: string;
    hash?: string;
    salt?: string;
    /** RBAC role names assigned to this user */
    roles?: string[];
    /** Whether the user has verified their email address */
    emailVerified?: boolean;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteAdminUsersByIdRes = unknown;
export type DeleteAdminUsersByIdArgs = string;
export type AdminMigrationsRunRes = /** status 201 Successful response */ {
  data?: object;
};
export type AdminMigrationsRunArgs = ("true" | "false") | undefined;
export type AdminMigrationsStatusRes = /** status 200 Successful response */ {
  data?: object;
};
export type AdminMigrationsStatusArgs = undefined;
export type PostNotificationsMarkAllReadRes = /** status 200 Success */ {
  data?: {
    modified?: number;
  };
};
export type PostNotificationsMarkAllReadArgs = undefined;
export type GetNotificationsRes = /** status 200 Successful list */ {
  data?: {
    /** The document id (string so offline sync clients can mint ids) */
    _id: string;
    /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
    archivedAt?: string;
    /** Main notification message text shown in the inbox */
    body: string;
    /** Optional deep link or in-app route opened when the user taps the notification */
    href?: string;
    /** Optional category string used for icons or grouping in the UI */
    kind?: string;
    /** The user who owns this inbox row */
    ownerId: string;
    /** When the owner marked this notification as read; null means unread */
    readAt?: string;
    /** Short headline shown in the inbox list */
    title: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetNotificationsArgs = {
  _id?: {
    $in?: string[];
  };
  ownerId?:
    | any
    | {
        $in?: any[];
      };
  readAt?:
    | string
    | {
        /** When the owner marked this notification as read; null means unread */
        $gt?: string;
        /** When the owner marked this notification as read; null means unread */
        $gte?: string;
        /** When the owner marked this notification as read; null means unread */
        $lt?: string;
        /** When the owner marked this notification as read; null means unread */
        $lte?: string;
      };
  archivedAt?:
    | string
    | {
        /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
        $gt?: string;
        /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
        $gte?: string;
        /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
        $lt?: string;
        /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
        $lte?: string;
      };
  kind?:
    | string
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetNotificationsByIdRes = /** status 200 Successful read */ {
  /** The document id (string so offline sync clients can mint ids) */
  _id: string;
  /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
  archivedAt?: string;
  /** Main notification message text shown in the inbox */
  body: string;
  /** Optional deep link or in-app route opened when the user taps the notification */
  href?: string;
  /** Optional category string used for icons or grouping in the UI */
  kind?: string;
  /** The user who owns this inbox row */
  ownerId: string;
  /** When the owner marked this notification as read; null means unread */
  readAt?: string;
  /** Short headline shown in the inbox list */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetNotificationsByIdArgs = string;
export type PatchNotificationsByIdRes = /** status 200 Successful update */ {
  /** The document id (string so offline sync clients can mint ids) */
  _id: string;
  /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
  archivedAt?: string;
  /** Main notification message text shown in the inbox */
  body: string;
  /** Optional deep link or in-app route opened when the user taps the notification */
  href?: string;
  /** Optional category string used for icons or grouping in the UI */
  kind?: string;
  /** The user who owns this inbox row */
  ownerId: string;
  /** When the owner marked this notification as read; null means unread */
  readAt?: string;
  /** Short headline shown in the inbox list */
  title: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PatchNotificationsByIdArgs = {
  id: string;
  body: {
    /** The document id (string so offline sync clients can mint ids) */
    _id?: string;
    /** When the owner archived (dismissed) this notification; null means it is still in the active inbox */
    archivedAt?: string;
    /** Main notification message text shown in the inbox */
    body?: string;
    /** Optional deep link or in-app route opened when the user taps the notification */
    href?: string;
    /** Optional category string used for icons or grouping in the UI */
    kind?: string;
    /** The user who owns this inbox row */
    ownerId?: string;
    /** When the owner marked this notification as read; null means unread */
    readAt?: string;
    /** Short headline shown in the inbox list */
    title?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  };
};
export type DeleteNotificationsByIdRes = unknown;
export type DeleteNotificationsByIdArgs = string;
export type PostNotificationPreferencesRes = /** status 201 Successful create */ {
  /** The document id (string so offline sync clients can mint ids) */
  _id: string;
  /** Whether in-app inbox rows are created for this user */
  inapp?: boolean;
  /** Whether outbound email is sent for notifications */
  mail?: boolean;
  /** The user these preferences belong to */
  ownerId: string;
  /** Whether push notifications are sent for this user */
  push?: boolean;
  /** Whether SMS messages are sent for this user */
  sms?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PostNotificationPreferencesArgs = {
  /** The document id (string so offline sync clients can mint ids) */
  _id?: string;
  /** Whether in-app inbox rows are created for this user */
  inapp?: boolean;
  /** Whether outbound email is sent for notifications */
  mail?: boolean;
  /** The user these preferences belong to */
  ownerId?: string;
  /** Whether push notifications are sent for this user */
  push?: boolean;
  /** Whether SMS messages are sent for this user */
  sms?: boolean;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetNotificationPreferencesRes = /** status 200 Successful list */ {
  data?: {
    /** The document id (string so offline sync clients can mint ids) */
    _id: string;
    /** Whether in-app inbox rows are created for this user */
    inapp?: boolean;
    /** Whether outbound email is sent for notifications */
    mail?: boolean;
    /** The user these preferences belong to */
    ownerId: string;
    /** Whether push notifications are sent for this user */
    push?: boolean;
    /** Whether SMS messages are sent for this user */
    sms?: boolean;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetNotificationPreferencesArgs = {
  _id?: {
    $in?: string[];
  };
  ownerId?:
    | any
    | {
        $in?: any[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetNotificationPreferencesByIdRes = /** status 200 Successful read */ {
  /** The document id (string so offline sync clients can mint ids) */
  _id: string;
  /** Whether in-app inbox rows are created for this user */
  inapp?: boolean;
  /** Whether outbound email is sent for notifications */
  mail?: boolean;
  /** The user these preferences belong to */
  ownerId: string;
  /** Whether push notifications are sent for this user */
  push?: boolean;
  /** Whether SMS messages are sent for this user */
  sms?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type GetNotificationPreferencesByIdArgs = string;
export type PatchNotificationPreferencesByIdRes = /** status 200 Successful update */ {
  /** The document id (string so offline sync clients can mint ids) */
  _id: string;
  /** Whether in-app inbox rows are created for this user */
  inapp?: boolean;
  /** Whether outbound email is sent for notifications */
  mail?: boolean;
  /** The user these preferences belong to */
  ownerId: string;
  /** Whether push notifications are sent for this user */
  push?: boolean;
  /** Whether SMS messages are sent for this user */
  sms?: boolean;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
  /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
  _syncPrevStream?: string;
  /** Monotonic per-stream sequence stamped on every synced write */
  _syncSeq?: number;
};
export type PatchNotificationPreferencesByIdArgs = {
  id: string;
  body: {
    /** The document id (string so offline sync clients can mint ids) */
    _id?: string;
    /** Whether in-app inbox rows are created for this user */
    inapp?: boolean;
    /** Whether outbound email is sent for notifications */
    mail?: boolean;
    /** The user these preferences belong to */
    ownerId?: string;
    /** Whether push notifications are sent for this user */
    push?: boolean;
    /** Whether SMS messages are sent for this user */
    sms?: boolean;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
    /** The document's previous sync stream, set when a write moved it between scopes; null when the last write did not move it */
    _syncPrevStream?: string;
    /** Monotonic per-stream sequence stamped on every synced write */
    _syncSeq?: number;
  };
};
export type DeleteNotificationPreferencesByIdRes = unknown;
export type DeleteNotificationPreferencesByIdArgs = string;
export type GetAnnouncementsConfigRes = /** status 200 Success */ {
  data?: {
    /** "required" or "dismiss-only" */
    defaultAcknowledgementPolicy?: string;
  };
};
export type GetAnnouncementsConfigArgs = undefined;
export type GetAnnouncementsOverviewRes = /** status 200 Success */ {
  data?: {
    _id?: string;
    acknowledgementPolicy?: string;
    audienceType?: string;
    displayMode?: string;
    expiresAt?: string;
    metrics?: {
      acknowledgements?: number;
      clicks?: number;
      impressions?: number;
    };
    priority?: number;
    publishedAt?: string;
    status?: string;
    title?: string;
    version?: number;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
  totals?: {
    acknowledgements?: number;
    announcements?: number;
    archived?: number;
    clicks?: number;
    draft?: number;
    impressions?: number;
    published?: number;
  };
};
export type GetAnnouncementsOverviewArgs = {
  page?: number;
  limit?: number;
};
export type PostAnnouncementsImportReleaseRes = /** status 200 Successful response */ {
  data?: object;
};
export type PostAnnouncementsImportReleaseArgs = {
  announcements: {
    acknowledgementPolicy?: "required" | "dismiss-only";
    audience?: any | null;
    audienceType?: "staff" | "patient" | "all";
    displayMode?: "modal" | "banner" | "feed";
    expiresAt?: string;
    minBuildNumber?: number;
    platforms?: ("ios" | "android" | "web")[];
    priority?: number;
    publishAt?: string;
    body: string;
    primaryAction?: {
      label: string;
      url: string;
    };
    slug: string;
    title: string;
  }[];
  defaults?: {
    acknowledgementPolicy?: "required" | "dismiss-only";
    audience?: any | null;
    audienceType?: "staff" | "patient" | "all";
    displayMode?: "modal" | "banner" | "feed";
    expiresAt?: string;
    minBuildNumber?: number;
    platforms?: ("ios" | "android" | "web")[];
    priority?: number;
    publishAt?: string;
  };
  publish?: boolean;
  release: {
    buildNumber?: number;
    channel?: string;
    product: string;
    version: string;
  };
};
export type PostAnnouncementsRes = /** status 201 Successful create */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PostAnnouncementsArgs = {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body?: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status?: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title?: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id?: string;
  /** When this document was last updated */
  updated?: string;
  /** When this document was created */
  created?: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAnnouncementsRes = /** status 200 Successful list */ {
  data?: {
    /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
    acknowledgementPolicy?: "required" | "dismiss-only";
    /** When the announcement was archived */
    archivedAt?: string;
    /** Opaque targeting metadata consumed by matchAudience callback */
    audience?: any;
    /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
    audienceType?: "staff" | "patient" | "all";
    /** Markdown body shown in the announcement modal */
    body: string;
    /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
    displayMode?: "modal" | "banner" | "feed";
    /** Optional expiry — hidden from pending/feed after this time */
    expiresAt?: string;
    /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
    minBuildNumber?: number;
    /** Platforms that should receive this announcement */
    platforms?: ("ios" | "android" | "web")[];
    primaryAction?: {
      /** Button label for optional primary action */
      label?: string;
      /** Deep link or external URL opened by the primary action button */
      url?: string;
    };
    /** Higher priority announcements appear first in the modal queue */
    priority?: number;
    /** Optional scheduled publish time — hidden until this instant */
    publishAt?: string;
    /** When the announcement was first published */
    publishedAt?: string;
    release?: {
      /** Client build number associated with the imported product release */
      buildNumber?: number;
      /** Release channel associated with the imported announcement */
      channel?: string;
      /** Product identifier associated with the imported announcement */
      product?: string;
      /** User-facing product version associated with the imported announcement */
      version?: string;
    };
    /** Stable announcement identifier within an imported product release */
    releaseSlug?: string;
    /** Lifecycle status: draft, published, or archived */
    status: "draft" | "published" | "archived";
    /** Announcement title shown in modal and changelog feed */
    title: string;
    /** Content version — increments when published title/body changes */
    version?: number;
    _id: string;
    /** When this document was last updated */
    updated: string;
    /** When this document was created */
    created: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  }[];
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type GetAnnouncementsArgs = {
  _id?: {
    $in?: string[];
  };
  status?:
    | ("draft" | "published" | "archived")
    | {
        $in?: string[];
      };
  priority?:
    | number
    | {
        /** Higher priority announcements appear first in the modal queue */
        $gt?: number;
        /** Higher priority announcements appear first in the modal queue */
        $gte?: number;
        /** Higher priority announcements appear first in the modal queue */
        $lt?: number;
        /** Higher priority announcements appear first in the modal queue */
        $lte?: number;
      };
  title?:
    | string
    | {
        $in?: string[];
      };
  page?: number;
  sort?: string;
  limit?: number;
};
export type GetAnnouncementsByIdRes = /** status 200 Successful read */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type GetAnnouncementsByIdArgs = string;
export type PatchAnnouncementsByIdRes = /** status 200 Successful update */ {
  /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
  acknowledgementPolicy?: "required" | "dismiss-only";
  /** When the announcement was archived */
  archivedAt?: string;
  /** Opaque targeting metadata consumed by matchAudience callback */
  audience?: any;
  /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
  audienceType?: "staff" | "patient" | "all";
  /** Markdown body shown in the announcement modal */
  body: string;
  /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
  displayMode?: "modal" | "banner" | "feed";
  /** Optional expiry — hidden from pending/feed after this time */
  expiresAt?: string;
  /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
  minBuildNumber?: number;
  /** Platforms that should receive this announcement */
  platforms?: ("ios" | "android" | "web")[];
  primaryAction?: {
    /** Button label for optional primary action */
    label?: string;
    /** Deep link or external URL opened by the primary action button */
    url?: string;
  };
  /** Higher priority announcements appear first in the modal queue */
  priority?: number;
  /** Optional scheduled publish time — hidden until this instant */
  publishAt?: string;
  /** When the announcement was first published */
  publishedAt?: string;
  release?: {
    /** Client build number associated with the imported product release */
    buildNumber?: number;
    /** Release channel associated with the imported announcement */
    channel?: string;
    /** Product identifier associated with the imported announcement */
    product?: string;
    /** User-facing product version associated with the imported announcement */
    version?: string;
  };
  /** Stable announcement identifier within an imported product release */
  releaseSlug?: string;
  /** Lifecycle status: draft, published, or archived */
  status: "draft" | "published" | "archived";
  /** Announcement title shown in modal and changelog feed */
  title: string;
  /** Content version — increments when published title/body changes */
  version?: number;
  _id: string;
  /** When this document was last updated */
  updated: string;
  /** When this document was created */
  created: string;
  /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
  deleted?: boolean;
};
export type PatchAnnouncementsByIdArgs = {
  id: string;
  body: {
    /** Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time. */
    acknowledgementPolicy?: "required" | "dismiss-only";
    /** When the announcement was archived */
    archivedAt?: string;
    /** Opaque targeting metadata consumed by matchAudience callback */
    audience?: any;
    /** First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType. */
    audienceType?: "staff" | "patient" | "all";
    /** Markdown body shown in the announcement modal */
    body?: string;
    /** Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry */
    displayMode?: "modal" | "banner" | "feed";
    /** Optional expiry — hidden from pending/feed after this time */
    expiresAt?: string;
    /** Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value */
    minBuildNumber?: number;
    /** Platforms that should receive this announcement */
    platforms?: ("ios" | "android" | "web")[];
    primaryAction?: {
      /** Button label for optional primary action */
      label?: string;
      /** Deep link or external URL opened by the primary action button */
      url?: string;
    };
    /** Higher priority announcements appear first in the modal queue */
    priority?: number;
    /** Optional scheduled publish time — hidden until this instant */
    publishAt?: string;
    /** When the announcement was first published */
    publishedAt?: string;
    release?: {
      /** Client build number associated with the imported product release */
      buildNumber?: number;
      /** Release channel associated with the imported announcement */
      channel?: string;
      /** Product identifier associated with the imported announcement */
      product?: string;
      /** User-facing product version associated with the imported announcement */
      version?: string;
    };
    /** Stable announcement identifier within an imported product release */
    releaseSlug?: string;
    /** Lifecycle status: draft, published, or archived */
    status?: "draft" | "published" | "archived";
    /** Announcement title shown in modal and changelog feed */
    title?: string;
    /** Content version — increments when published title/body changes */
    version?: number;
    _id?: string;
    /** When this document was last updated */
    updated?: string;
    /** When this document was created */
    created?: string;
    /** Deleted objects are not returned in any find() or findOne() by default. Add {deleted: true} to find them. */
    deleted?: boolean;
  };
};
export type DeleteAnnouncementsByIdRes = unknown;
export type DeleteAnnouncementsByIdArgs = string;
export type PostOrgsRes = unknown;
export type PostOrgsArgs = {
  /** Organization name */
  name: string;
  /** App-defined organization settings */
  settings?: object;
};
export type GetOrgsRes = unknown;
export type GetOrgsArgs = undefined;
export type GetOrgsMineRes = unknown;
export type GetOrgsMineArgs = undefined;
export type GetOrgsByIdRes = unknown;
export type GetOrgsByIdArgs = string;
export type PatchOrgsByIdRes = unknown;
export type PatchOrgsByIdArgs = {
  id: string;
  body: {
    /** Disable the organization */
    disabled?: boolean;
    /** Organization name */
    name?: string;
    /** App-defined organization settings */
    settings?: object;
  };
};
export type DeleteOrgsByIdRes = unknown;
export type DeleteOrgsByIdArgs = string;
export type GetOrgsByIdMembersRes = unknown;
export type GetOrgsByIdMembersArgs = string;
export type PostOrgsByIdMembersRes = unknown;
export type PostOrgsByIdMembersArgs = {
  id: string;
  body: {
    /** Existing user email */
    email?: string;
    /** Membership role */
    roleName?: string;
    /** Existing user id */
    userId?: string;
  };
};
export type PatchOrgsByIdMembersAndMemberIdRes = unknown;
export type PatchOrgsByIdMembersAndMemberIdArgs = {
  id: string;
  memberId: string;
  body: {
    /** Membership role */
    roleName?: string;
    /** Membership status */
    status?: string;
  };
};
export type DeleteOrgsByIdMembersAndMemberIdRes = unknown;
export type DeleteOrgsByIdMembersAndMemberIdArgs = {
  id: string;
  memberId: string;
};
export type CreateMcpServiceTokenRes = /** status 200 Success */ {
  data?: {
    created?: string;
    expiresAt?: string;
    id?: string;
    mcpUrl?: string;
    name?: string;
    token?: string;
    tokenPrefix?: string;
  };
};
export type CreateMcpServiceTokenArgs = {
  /** Optional ISO-8601 expiry; omit for a token that does not expire */
  expiresAt?: string;
  /** User-visible label for this token */
  name: string;
};
export type ListMcpServiceTokensRes = /** status 200 Success */ {
  data?: any;
  limit?: number;
  more?: boolean;
  page?: number;
  total?: number;
};
export type ListMcpServiceTokensArgs = {
  page?: number;
  limit?: number;
};
export type RevokeMcpServiceTokenRes = /** status 200 Success */ {
  data?: {
    id?: string;
    revokedAt?: string;
  };
};
export type RevokeMcpServiceTokenArgs = string;
export type ApiError = {
  /** An application-specific error code, expressed as a string value. */
  code?: string;
  /** A human-readable explanation specific to this occurrence of the problem. Like title, this field’s value can be localized. */
  detail?: string;
  /** A unique identifier for this particular occurrence of the problem. */
  id?: string;
  links?: {
    /** A link that leads to further details about this particular occurrence of the problem. When derefenced, this URI SHOULD return a human-readable description of the error. */
    about?: string;
    /** A link that identifies the type of error that this particular error is an instance of. This URI SHOULD be dereferencable to a human-readable explanation of the general error. */
    type?: string;
  };
  /** A meta object containing non-standard meta-information about the error. */
  meta?: object;
  source?: {
    /** A string indicating the name of a single request header which caused the error. */
    header?: string;
    /** A string indicating which URI query parameter caused the error. */
    parameter?: string;
    /** A JSON Pointer [RFC6901] to the associated entity in the request document [e.g. "/data" for a primary data object, or "/data/attributes/title" for a specific attribute]. */
    pointer?: string;
  };
  /** The HTTP status code applicable to this problem, expressed as a string value. */
  status?: number;
  /** The error message */
  title?: string;
};
export const {
  usePostAiExampleSummarizeMutation,
  usePostGptHistoriesMutation,
  useGetGptHistoriesQuery,
  useGetGptHistoriesByIdQuery,
  usePatchGptHistoriesByIdMutation,
  useDeleteGptHistoriesByIdMutation,
  usePostGptPromptMutation,
  usePatchGptHistoriesByIdRatingMutation,
  usePostGptRemixMutation,
  useGetGptToolsQuery,
  useAiModelsQuery,
  useSettingsClearGcsMutation,
  useSettingsConfigureGcsMutation,
  useSettingsGcsQuery,
  usePostNotificationsDevNotifyMutation,
  useTodosMarkCompleteMutation,
  useLoadtestLoadtestChurnMutation,
  useLoadtestLoadtestClearMutation,
  useLoadtestLoadtestGenerateMutation,
  useTodosBulkCompleteMutation,
  usePostTodosMutation,
  useGetTodosQuery,
  useGetTodosByIdQuery,
  usePatchTodosByIdMutation,
  useDeleteTodosByIdMutation,
  usePostProjectsMutation,
  useGetProjectsQuery,
  useGetProjectsByIdQuery,
  usePatchProjectsByIdMutation,
  useDeleteProjectsByIdMutation,
  usePostUsersByIdPasswordMutation,
  usePostUsersMutation,
  useGetUsersQuery,
  useGetUsersByIdQuery,
  usePatchUsersByIdMutation,
  useDeleteUsersByIdMutation,
  useCommsTestPushMutation,
  usePostCommsPushTokensMutation,
  useGetCommsPushTokensQuery,
  useDeleteCommsPushTokensByIdMutation,
  useGetCommsPushTokensByIdQuery,
  useGetCommsMessagesQuery,
  usePostCommsMessagesRetryManyMutation,
  useGetCommsMessagesByIdQuery,
  usePostCommsMessagesByIdRetryMutation,
  useGetCommsStatsQuery,
  usePostFeatureFlagsFlagsMutation,
  useGetFeatureFlagsFlagsQuery,
  useGetFeatureFlagsFlagsByIdQuery,
  usePatchFeatureFlagsFlagsByIdMutation,
  useDeleteFeatureFlagsFlagsByIdMutation,
  useGetJobsSchedulesQuery,
  usePostJobsSchedulesByNamePauseMutation,
  usePostJobsSchedulesByNameResumeMutation,
  useGetJobsQuery,
  useGetJobsStatsQuery,
  useGetJobsByIdQuery,
  usePostJobsByIdRetryMutation,
  usePostJobsByIdRequeueMutation,
  usePostJobsByIdCancelMutation,
  useGetAiObservabilityStatusQuery,
  useGetAiObservabilityPromptsQuery,
  usePostAiObservabilityPromptsMutation,
  useGetAiObservabilityPromptsByNameQuery,
  usePostAiObservabilityPromptsByNameVersionsMutation,
  usePostAiObservabilityPromptsByNameLabelsMutation,
  usePostAiObservabilityPromptsByNamePlaygroundMutation,
  useGetAiObservabilityEvaluatorsTemplatesQuery,
  usePostAiObservabilityEvaluatorsTemplatesByNameMutation,
  useGetAiObservabilityEvaluatorsQuery,
  usePostAiObservabilityEvaluatorsMutation,
  useGetAiObservabilityEvaluatorsByIdQuery,
  usePatchAiObservabilityEvaluatorsByIdMutation,
  useDeleteAiObservabilityEvaluatorsByIdMutation,
  usePostAiObservabilityTracesReviewMutation,
  useGetAiObservabilityReviewQuery,
  useGetAiObservabilityReviewByIdQuery,
  usePostAiObservabilityReviewByIdMutation,
  useGetAiObservabilityDatasetsQuery,
  usePostAiObservabilityDatasetsMutation,
  useGetAiObservabilityDatasetsByIdQuery,
  usePatchAiObservabilityDatasetsByIdMutation,
  useDeleteAiObservabilityDatasetsByIdMutation,
  useGetAiObservabilityDatasetsByIdItemsQuery,
  usePostAiObservabilityDatasetsByIdItemsMutation,
  usePatchAiObservabilityDatasetsByIdItemsAndItemIdMutation,
  useDeleteAiObservabilityDatasetsByIdItemsAndItemIdMutation,
  usePostAiObservabilityDatasetsByIdImportMutation,
  usePostAiObservabilityTracesAddToDatasetMutation,
  usePostAiObservabilityExperimentsEstimateMutation,
  useGetAiObservabilityExperimentsQuery,
  usePostAiObservabilityExperimentsMutation,
  useGetAiObservabilityExperimentsByIdQuery,
  usePostAiObservabilityExperimentsByIdPromoteMutation,
  useGetAiObservabilityTracesQuery,
  useGetAiObservabilityTracesByIdQuery,
  usePostAiObservabilityTracesByIdScoresMutation,
  usePostAiObservabilityTracesTestMultiStageMutation,
  useHarnessSubmitMutation,
  useGetHarnessConversationsQuery,
  useGetHarnessConversationsByIdQuery,
  useHarnessAbortMutation,
  useHarnessResolveInterruptedMutation,
  useGetHarnessTasksByIdQuery,
  useHarnessApproveMutation,
  useHarnessRejectMutation,
  useGetHarnessApprovalsQuery,
  useGetHarnessApprovalsByIdQuery,
  useGetAdminConfigQuery,
  usePostAdminBackgroundTasksMutation,
  usePostAdminMcpServiceTokensBulkPatchMutation,
  useGetAdminMcpServiceTokensQuery,
  useGetAdminMcpServiceTokensByIdQuery,
  useDeleteAdminMcpServiceTokensByIdMutation,
  usePostAdminFeatureFlagsBulkPatchMutation,
  usePostAdminFeatureFlagsMutation,
  useGetAdminFeatureFlagsQuery,
  useGetAdminFeatureFlagsByIdQuery,
  usePatchAdminFeatureFlagsByIdMutation,
  useDeleteAdminFeatureFlagsByIdMutation,
  usePostAdminAuditEventsBulkPatchMutation,
  useGetAdminAuditEventsQuery,
  useGetAdminAuditEventsByIdQuery,
  usePostAdminConsentFormsBulkPatchMutation,
  usePostAdminConsentFormsMutation,
  useGetAdminConsentFormsQuery,
  useGetAdminConsentFormsByIdQuery,
  usePatchAdminConsentFormsByIdMutation,
  useDeleteAdminConsentFormsByIdMutation,
  usePostAdminConsentResponsesBulkPatchMutation,
  useGetAdminConsentResponsesQuery,
  useGetAdminConsentResponsesByIdQuery,
  usePostAdminAnnouncementsBulkPatchMutation,
  usePostAdminAnnouncementsMutation,
  useGetAdminAnnouncementsQuery,
  useGetAdminAnnouncementsByIdQuery,
  usePatchAdminAnnouncementsByIdMutation,
  useDeleteAdminAnnouncementsByIdMutation,
  usePostAdminAnnouncementAcknowledgementsBulkPatchMutation,
  useGetAdminAnnouncementAcknowledgementsQuery,
  useGetAdminAnnouncementAcknowledgementsByIdQuery,
  usePostAdminAnnouncementImpressionsBulkPatchMutation,
  useGetAdminAnnouncementImpressionsQuery,
  useGetAdminAnnouncementImpressionsByIdQuery,
  usePostAdminAnnouncementClickEventsBulkPatchMutation,
  useGetAdminAnnouncementClickEventsQuery,
  useGetAdminAnnouncementClickEventsByIdQuery,
  usePostAdminTodosBulkPatchMutation,
  usePostAdminTodosMutation,
  useGetAdminTodosQuery,
  useGetAdminTodosByIdQuery,
  usePatchAdminTodosByIdMutation,
  useDeleteAdminTodosByIdMutation,
  usePostAdminUsersBulkPatchMutation,
  usePostAdminUsersMutation,
  useGetAdminUsersQuery,
  useGetAdminUsersByIdQuery,
  usePatchAdminUsersByIdMutation,
  useDeleteAdminUsersByIdMutation,
  useAdminMigrationsRunMutation,
  useAdminMigrationsStatusQuery,
  usePostNotificationsMarkAllReadMutation,
  useGetNotificationsQuery,
  useGetNotificationsByIdQuery,
  usePatchNotificationsByIdMutation,
  useDeleteNotificationsByIdMutation,
  usePostNotificationPreferencesMutation,
  useGetNotificationPreferencesQuery,
  useGetNotificationPreferencesByIdQuery,
  usePatchNotificationPreferencesByIdMutation,
  useDeleteNotificationPreferencesByIdMutation,
  useGetAnnouncementsConfigQuery,
  useGetAnnouncementsOverviewQuery,
  usePostAnnouncementsImportReleaseMutation,
  usePostAnnouncementsMutation,
  useGetAnnouncementsQuery,
  useGetAnnouncementsByIdQuery,
  usePatchAnnouncementsByIdMutation,
  useDeleteAnnouncementsByIdMutation,
  usePostOrgsMutation,
  useGetOrgsQuery,
  useGetOrgsMineQuery,
  useGetOrgsByIdQuery,
  usePatchOrgsByIdMutation,
  useDeleteOrgsByIdMutation,
  useGetOrgsByIdMembersQuery,
  usePostOrgsByIdMembersMutation,
  usePatchOrgsByIdMembersAndMemberIdMutation,
  useDeleteOrgsByIdMembersAndMemberIdMutation,
  useCreateMcpServiceTokenMutation,
  useListMcpServiceTokensQuery,
  useRevokeMcpServiceTokenMutation,
} = injectedRtkApi;
