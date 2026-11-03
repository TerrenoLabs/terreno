import {afterEach, describe, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminObjectPicker} from "../AdminObjectPicker";
import {AdminProvider} from "../AdminProvider";
import {AdminVersionConfig} from "../AdminVersionConfig";
import {useCommsDashboardApi} from "../comms/useCommsDashboardApi";
import type {AdminApi, AdminConfigResponse} from "../types";
import {useAdminBackgroundTaskMutation} from "../useAdminBackgroundTask";
import {useAdminConfig} from "../useAdminConfig";
import {useAdminRoles} from "../useAdminRoles";
import {useAdminRpc, useAdminRpcMutation} from "../useAdminRpc";
import {useAdminScripts} from "../useAdminScripts";
import {useConfigurationApi} from "../useConfigurationApi";
import {useConsentHistory} from "../useConsentHistory";
import {useDocumentStorageApi} from "../useDocumentStorageApi";
import {AIRequestsScreenWidget} from "../widgets/AIRequestsScreenWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const makeApi = (): AdminApi => {
  const api: Record<string, unknown> = {};
  const hooks = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop.startsWith("use") && prop.endsWith("Mutation")) {
          return () => [() => ({unwrap: async () => ({})}), {isLoading: false}];
        }
        if (typeof prop === "string" && prop.startsWith("use")) {
          return () => ({
            data: undefined,
            error: null,
            isFetching: false,
            isLoading: false,
            refetch: () => undefined,
          });
        }
        return undefined;
      },
    }
  );
  api.enhanceEndpoints = () => api;
  api.injectEndpoints = ({
    endpoints,
  }: {
    endpoints: (build: {
      mutation: (definition: unknown) => unknown;
      query: (definition: unknown) => unknown;
    }) => Record<string, unknown>;
  }) => {
    const definitions = endpoints({
      mutation: (definition: unknown): unknown => definition,
      query: (definition: unknown): unknown => definition,
    });
    const representativeArg = {
      body: {},
      changes: {},
      filePath: "file.txt",
      folderName: "folder",
      folderPath: "folder",
      formData: new FormData(),
      id: "id-1",
      limit: 20,
      name: "cleanup",
      page: 1,
      params: {},
      patch: {},
      prefix: "prefix",
      roleName: "reviewer",
      taskId: "task-1",
      wetRun: false,
    };
    for (const definition of Object.values(definitions)) {
      const query = (definition as {query?: (arg: unknown) => unknown}).query;
      query?.(representativeArg);
    }
    return hooks;
  };
  return api as AdminApi;
};

const runHookWithRpc = <T,>(fn: () => T): T => {
  let captured: T | undefined;
  const Probe: React.FC = () => {
    captured = fn();
    return null;
  };
  const api = makeApi();
  renderWithTheme(
    <AdminProvider api={api} apiBase="/admin" credentials="same-origin" getAuthHeaders={() => ({})}>
      <Probe />
    </AdminProvider>
  );
  return captured as T;
};

const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("admin RPC dual-run", () => {
  const originalFetch = globalThis.fetch;
  const captured: {method?: string; url: string}[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured.length = 0;
  });

  const mockOkFetch = (): void => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured.push({method: init?.method, url: String(url)});
      return new Response(JSON.stringify({data: [], ok: true}), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  };

  it("useAdminConfig GETs /admin/config via fetch", async () => {
    mockOkFetch();
    runHookWithRpc(() => useAdminConfig(makeApi(), "/admin"));
    await flushEffects();
    assert.deepEqual(captured, [{method: "GET", url: "/admin/config"}]);
  });

  it("useAdminScripts run mutation POSTs the script run URL", async () => {
    mockOkFetch();
    const result = runHookWithRpc(() => {
      const {useRunScriptMutation} = useAdminScripts(makeApi(), "/admin");
      return useRunScriptMutation();
    });
    await result[0]({name: "migrate", wetRun: false}).unwrap();
    assert.deepEqual(captured, [{method: "POST", url: "/admin/scripts/migrate/run?wetRun=false"}]);
  });

  it("useAdminRoles lists roles at the rbac root", async () => {
    mockOkFetch();
    runHookWithRpc(() => {
      const {useListRolesQuery} = useAdminRoles(makeApi(), "/admin");
      return useListRolesQuery();
    });
    await flushEffects();
    assert.deepEqual(captured, [{method: "GET", url: "/rbac/roles"}]);
  });

  it("useConfigurationApi GETs configuration values", async () => {
    mockOkFetch();
    runHookWithRpc(() => {
      const {useValuesQuery} = useConfigurationApi({
        api: makeApi(),
        basePath: "/admin/configuration",
      });
      return useValuesQuery();
    });
    await flushEffects();
    assert.deepEqual(captured, [{method: "GET", url: "/admin/configuration"}]);
  });

  it("useDocumentStorageApi lists with a prefix query string", async () => {
    mockOkFetch();
    runHookWithRpc(() => {
      const {useListQuery} = useDocumentStorageApi(makeApi(), "/documents");
      return useListQuery("inbox");
    });
    await flushEffects();
    assert.deepEqual(captured, [{method: "GET", url: "/documents/?prefix=inbox"}]);
  });

  it("useAdminBackgroundTaskMutation POSTs /admin/background-tasks", async () => {
    mockOkFetch();
    const [enqueue] = runHookWithRpc(() => useAdminBackgroundTaskMutation(makeApi(), "/admin/"));
    await enqueue({kind: "bulk-patch"}).unwrap();
    assert.deepEqual(captured, [{method: "POST", url: "/admin/background-tasks"}]);
  });

  it("useConsentHistory GETs /consents/my", async () => {
    mockOkFetch();
    runHookWithRpc(() => useConsentHistory(makeApi() as never, "/admin"));
    await flushEffects();
    assert.deepEqual(captured, [{method: "GET", url: "/admin/consents/my"}]);
  });

  it("useCommsDashboardApi lists messages with query params", async () => {
    mockOkFetch();
    runHookWithRpc(() => {
      const {useListQuery} = useCommsDashboardApi(makeApi());
      return useListQuery({limit: 20, page: 1} as never);
    });
    await flushEffects();
    assert.include(captured[0]?.url ?? "", "/comms/messages");
    assert.strictEqual(captured[0]?.method, "GET");
  });

  it("comms queries and retry mutations preserve RTK invalidation behavior", async () => {
    mockOkFetch();
    const hooks = runHookWithRpc(() => {
      const comms = useCommsDashboardApi(makeApi());
      comms.useDetailQuery("message-1");
      comms.useListQuery({limit: 10, page: 2} as never);
      comms.useStatsQuery({page: 2} as never);
      const [retry] = comms.useRetryMutation();
      const [retryMany] = comms.useRetryManyMutation();
      return {retry, retryMany};
    });
    await flushEffects();
    await hooks.retry("message-1").unwrap();
    await hooks.retryMany({ids: ["message-1"]}).unwrap();
    assert.ok(captured.some((row) => row.url === "/comms/messages/message-1"));
    assert.ok(captured.some((row) => row.url.includes("/comms/stats")));
    assert.ok(
      captured.some((row) => row.method === "POST" && row.url === "/comms/messages/message-1/retry")
    );
    assert.ok(
      captured.some((row) => row.method === "POST" && row.url === "/comms/messages/retryMany")
    );
  });

  it("scripts expose task/history queries and cancel/run mutations", async () => {
    mockOkFetch();
    const hooks = runHookWithRpc(() => {
      const scripts = useAdminScripts(makeApi(), "/admin");
      scripts.useGetScriptTaskQuery("task-1");
      scripts.useListScriptRunsQuery({limit: 5, name: "cleanup", page: 2});
      const [cancel] = scripts.useCancelScriptTaskMutation();
      const [run] = scripts.useRunScriptMutation();
      return {cancel, run};
    });
    await flushEffects();
    await hooks.cancel("task-1").unwrap();
    await hooks.run({name: "cleanup", wetRun: true}).unwrap();
    assert.ok(captured.some((row) => row.url === "/admin/scripts/tasks/task-1"));
    assert.ok(
      captured.some((row) => row.url === "/admin/scripts/runs?page=2&limit=5&name=cleanup")
    );
    assert.ok(
      captured.some((row) => row.method === "DELETE" && row.url === "/admin/scripts/tasks/task-1")
    );
    assert.ok(
      captured.some(
        (row) => row.method === "POST" && row.url === "/admin/scripts/cleanup/run?wetRun=true"
      )
    );
  });

  it("configuration queries and mutations use fetch RPC", async () => {
    mockOkFetch();
    const hooks = runHookWithRpc(() => {
      const configuration = useConfigurationApi({
        api: makeApi(),
        basePath: "/admin/configuration",
      });
      configuration.useMetaQuery();
      configuration.useValuesQuery();
      const [refresh] = configuration.useRefreshSecretsMutation();
      const [update] = configuration.useUpdateMutation();
      return {refresh, update};
    });
    await flushEffects();
    await hooks.refresh({}).unwrap();
    await hooks.update({enabled: true}).unwrap();
    assert.ok(captured.some((row) => row.url === "/admin/configuration/meta"));
    assert.ok(captured.some((row) => row.url === "/admin/configuration"));
    assert.ok(
      captured.some(
        (row) => row.method === "POST" && row.url === "/admin/configuration/refresh-secrets"
      )
    );
    assert.ok(captured.some((row) => row.method === "PATCH" && row.url === "/admin/configuration"));
  });

  it("document storage covers folder, file, list, and upload RPCs", async () => {
    mockOkFetch();
    const hooks = runHookWithRpc(() => {
      const documents = useDocumentStorageApi(makeApi(), "/documents");
      documents.useListQuery();
      const [createFolder] = documents.useCreateFolderMutation();
      const [deleteFolder] = documents.useDeleteFolderMutation();
      const [deleteFile] = documents.useDeleteMutation();
      const [upload] = documents.useUploadMutation();
      return {createFolder, deleteFile, deleteFolder, upload};
    });
    await flushEffects();
    await hooks.createFolder({folderName: "Reports", prefix: "private"}).unwrap();
    await hooks.deleteFolder("private/Reports").unwrap();
    await hooks.deleteFile("private/report.pdf").unwrap();
    await hooks.upload({formData: new FormData(), prefix: "private"}).unwrap();
    assert.ok(captured.some((row) => row.url === "/documents/"));
    assert.ok(captured.some((row) => row.url === "/documents/folder"));
    assert.ok(captured.some((row) => row.url.includes("private%2FReports")));
    assert.ok(captured.some((row) => row.url.includes("private%2Freport.pdf")));
  });

  it("roles cover statements plus create and update RPCs", async () => {
    mockOkFetch();
    const hooks = runHookWithRpc(() => {
      const roles = useAdminRoles(makeApi(), "/admin");
      roles.useListStatementsQuery();
      const [create] = roles.useCreateRoleMutation();
      const [update] = roles.useUpdateRoleMutation();
      return {create, update};
    });
    await flushEffects();
    await hooks.create({name: "reviewer"} as never).unwrap();
    await hooks
      .update({changes: {description: "Can review"} as never, roleName: "reviewer"})
      .unwrap();
    assert.ok(captured.some((row) => row.url === "/rbac/statements"));
    assert.ok(captured.some((row) => row.method === "POST" && row.url === "/rbac/roles"));
    assert.ok(captured.some((row) => row.method === "PATCH" && row.url === "/rbac/roles/reviewer"));
  });

  it("document download uses parseAs blob", async () => {
    mockOkFetch();
    const result = runHookWithRpc(() => {
      const {useLazyDownloadQuery} = useDocumentStorageApi(makeApi(), "/documents");
      return useLazyDownloadQuery();
    });
    await result[0]("a.pdf").unwrap();
    assert.deepEqual(captured, [{method: "GET", url: "/documents/download/a.pdf"}]);
  });

  it("AI explorer GETs /aiRequestsExplorer", async () => {
    mockOkFetch();
    renderWithTheme(
      <AdminProvider
        api={makeApi()}
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
      >
        <AIRequestsScreenWidget
          api={makeApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="aiRequests"
        />
      </AdminProvider>
    );
    await flushEffects();
    assert.ok(captured.some((row) => row.url.includes("/aiRequestsExplorer")));
    assert.strictEqual(
      captured.find((row) => row.url.includes("/aiRequestsExplorer"))?.method,
      "GET"
    );
  });

  it("version-config GETs /admin/version-config", async () => {
    mockOkFetch();
    renderWithTheme(
      <AdminProvider
        api={makeApi()}
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
      >
        <AdminVersionConfig api={makeApi()} apiBase="/admin" />
      </AdminProvider>
    );
    await flushEffects();
    assert.deepEqual(
      captured.filter((row) => row.url.includes("version-config")),
      [{method: "GET", url: "/admin/version-config"}]
    );
  });

  it("consent form RPC mutations hit generate, publish, and translate", async () => {
    mockOkFetch();
    const trigger = runHookWithRpc(() => {
      const rpc = useAdminRpc();
      const [run] = useAdminRpcMutation(rpc);
      return run;
    });
    await trigger({
      body: {description: "d", locale: "en", type: "terms"},
      method: "POST",
      url: "/consent-forms/generate",
    }).unwrap();
    await trigger({method: "POST", url: "/consent-forms/form-id/publish"}).unwrap();
    await trigger({
      body: {content: "hi", fromLocale: "en", toLocale: "es"},
      method: "POST",
      url: "/consent-forms/translate",
    }).unwrap();
    assert.deepEqual(
      captured.map((row) => `${row.method} ${row.url}`),
      [
        "POST /consent-forms/generate",
        "POST /consent-forms/form-id/publish",
        "POST /consent-forms/translate",
      ]
    );
  });

  it("AdminObjectPicker reads and searches via fetch", async () => {
    mockOkFetch();
    renderWithTheme(
      <AdminProvider
        api={makeApi()}
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
      >
        <AdminObjectPicker
          api={makeApi()}
          autocomplete
          onChange={() => undefined}
          refModelName="User"
          routePath="/admin/users"
          title="User"
          value="user-1"
        />
      </AdminProvider>
    );
    await flushEffects();
    assert.ok(
      captured.some((row) => row.method === "GET" && row.url === "/admin/users/user-1"),
      "selected id is fetched"
    );

    captured.length = 0;
    const empty = renderWithTheme(
      <AdminProvider
        api={makeApi()}
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
      >
        <AdminObjectPicker
          api={makeApi()}
          autocomplete
          onChange={() => undefined}
          refModelName="User"
          routePath="/admin/users"
          title="User"
          value=""
        />
      </AdminProvider>
    );
    fireEvent.changeText(empty.getByTestId("admin-picker-User-search"), "ada");
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 350);
      });
    });
    assert.ok(
      captured.some((row) => row.method === "GET" && row.url.includes("/admin/users/search")),
      "search uses fetch"
    );
  });
});
