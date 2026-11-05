// noExplicitAny: RTK Query API proxy uses dynamic property access and type-erased endpoint builders
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
/**
 * Tests for admin-frontend hooks: useAdminApi, useAdminConfig,
 * useAdminScripts, useConfigurationApi, useDocumentStorageApi.
 *
 * These hooks all inject RTK Query endpoints into a provided Api instance,
 * and expose generated RTK hooks by name. We assert:
 *  - the right endpoint keys are injected with expected method/url shapes
 *  - the returned hook functions correspond to the generated hook names
 */
import {describe, expect, it, mock} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {createApi} from "@reduxjs/toolkit/query/react";
import {act, waitFor} from "@testing-library/react-native";
import React from "react";
import {Provider} from "react-redux";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {adminOrgScopedArg} from "../orgs/adminModelEndpoints";
import {OrgContextProvider, useOrgContext} from "../orgs/useOrgContext";
import type {AdminApi} from "../types";
import {useAdminApi} from "../useAdminApi";
import {useAdminBackgroundTaskMutation} from "../useAdminBackgroundTask";
import {useAdminConfig} from "../useAdminConfig";
import {normalizeRoles, normalizeStatements, useAdminRoles} from "../useAdminRoles";
import {useAdminScripts} from "../useAdminScripts";
import {useConfigurationApi} from "../useConfigurationApi";
import {useDocumentStorageApi} from "../useDocumentStorageApi";

/** What an injected endpoint's `query` returns: an RTK Query request description. */
interface QuerySpec {
  [key: string]: unknown;
  method?: string;
  responseHandler?: (response: unknown) => Promise<unknown>;
  url?: string;
}

type TagsFn = (result: unknown, error: unknown, arg: unknown) => unknown;

/** An endpoint definition as captured by the mock builder. */
interface CapturedEndpoint {
  __kind?: "query" | "mutation";
  query: (arg?: unknown) => QuerySpec;
  providesTags?: unknown;
  invalidatesTags?: unknown;
  serializeQueryArgs?: (args: {endpointName: string; queryArgs: unknown}) => string;
}

type CapturedEndpoints = Record<string, CapturedEndpoint>;

/** The proxy double handed to the hooks, plus what it recorded. */
type MockAdminApi = AdminApi & {
  readonly __injected: CapturedEndpoints;
  readonly __tagTypes: string[];
};

/** Calls an endpoint's function-form `providesTags` / `invalidatesTags` for `arg`. */
const callTags = (tags: unknown, arg: unknown): unknown => {
  if (typeof tags !== "function") {
    throw new Error("Expected a tag function");
  }
  return (tags as TagsFn)(null, null, arg);
};

/** Calls an endpoint's `serializeQueryArgs`, failing when the endpoint has none. */
const serializeArgs = (endpoint: CapturedEndpoint, endpointName: string, queryArgs: unknown) => {
  if (!endpoint.serializeQueryArgs) {
    throw new Error(`${endpointName} has no serializeQueryArgs`);
  }
  return endpoint.serializeQueryArgs({endpointName, queryArgs});
};

const makeMockApi = (): MockAdminApi => {
  const injected: CapturedEndpoints = {};
  const enhancedTagTypes: string[] = [];

  const fakeHooks: Record<string, unknown> = {};

  const addHookFor = (key: string, type: "query" | "mutation") => {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const hookName = type === "query" ? `use${cap(key)}Query` : `use${cap(key)}Mutation`;
    const lazyHookName = `useLazy${cap(key)}Query`;
    fakeHooks[hookName] = mock(() =>
      type === "query"
        ? {data: undefined, error: null, isLoading: false}
        : [mock(() => ({unwrap: async () => ({})})), {isLoading: false}]
    );
    if (type === "query") {
      fakeHooks[lazyHookName] = mock(() => [
        mock(() => ({unwrap: async () => ({})})),
        {data: undefined, isLoading: false},
      ]);
    }
  };

  const base: Record<string, unknown> = {};
  Object.defineProperty(base, "__fakeHooks", {value: fakeHooks});
  Object.defineProperty(base, "__injected", {value: injected});
  Object.defineProperty(base, "__tagTypes", {value: enhancedTagTypes});

  const apiProxy: Record<string, unknown> = new Proxy(base, {
    get(target, prop: string) {
      if (prop === "enhanceEndpoints") {
        return ({addTagTypes}: {addTagTypes: string[]}) => {
          enhancedTagTypes.push(...addTagTypes);
          return apiProxy;
        };
      }
      if (prop === "injectEndpoints") {
        return ({endpoints}: {endpoints: (build: unknown) => CapturedEndpoints}) => {
          const build = {
            mutation: (spec: CapturedEndpoint): CapturedEndpoint => ({...spec, __kind: "mutation"}),
            query: (spec: CapturedEndpoint): CapturedEndpoint => ({...spec, __kind: "query"}),
          };
          const defs = endpoints(build);
          for (const [key, def] of Object.entries(defs)) {
            injected[key] = def;
            const kind = def.__kind === "mutation" ? "mutation" : "query";
            addHookFor(key, kind);
          }
          return apiProxy;
        };
      }
      if (prop in target) {
        return target[prop];
      }
      if (prop in fakeHooks) {
        return fakeHooks[prop];
      }
      return undefined;
    },
  });

  // Test double: the proxy answers only the Api members the hooks touch.
  return apiProxy as unknown as MockAdminApi;
};

const runHook = <T,>(fn: () => T): T => {
  let captured: T | undefined;
  const Probe = () => {
    captured = fn();
    return null;
  };
  renderWithTheme(<Probe />);
  return captured as T;
};

describe("useAdminApi", () => {
  it("injects list/read/create/update/delete endpoints with admin tag", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminApi(api, "/admin/users", "User"));

    const injected = api.__injected;
    expect(injected.adminList_User).toBeDefined();
    expect(injected.adminRead_User).toBeDefined();
    expect(injected.adminCreate_User).toBeDefined();
    expect(injected.adminUpdate_User).toBeDefined();
    expect(injected.adminDelete_User).toBeDefined();

    // tag types include the admin_<model>
    expect(api.__tagTypes).toContain("admin_User");

    // Each endpoint's query fn produces expected URL/method
    const listDef = injected.adminList_User;
    expect(listDef.query({limit: 1})).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/users?limit=1",
    });
    expect(listDef.query(undefined)).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/users",
    });

    const readDef = injected.adminRead_User;
    expect(readDef.query("abc")).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/users/abc",
    });
    expect(callTags(readDef.providesTags, "abc")).toEqual([{id: "abc", type: "admin_User"}]);

    const createDef = injected.adminCreate_User;
    expect(createDef.query({name: "x"})).toEqual({
      body: {name: "x"},
      headers: undefined,
      method: "POST",
      url: "/admin/users",
    });
    expect(createDef.invalidatesTags).toEqual(["admin_User"]);

    const updateDef = injected.adminUpdate_User;
    expect(updateDef.query({body: {x: 1}, id: "123"})).toEqual({
      body: {x: 1},
      headers: undefined,
      method: "PATCH",
      url: "/admin/users/123",
    });
    expect(callTags(updateDef.invalidatesTags, {id: "123"})).toEqual([
      {id: "123", type: "admin_User"},
      "admin_User",
    ]);

    const deleteDef = injected.adminDelete_User;
    expect(deleteDef.query("123")).toEqual({
      headers: undefined,
      method: "DELETE",
      url: "/admin/users/123",
    });

    const bulkPatchDef = injected.adminBulkPatch_User;
    expect(bulkPatchDef.query({ids: ["123"], patch: {name: "Patched"}})).toEqual({
      body: {ids: ["123"], patch: {name: "Patched"}},
      headers: undefined,
      method: "POST",
      url: "/admin/users/bulk-patch",
    });

    // Returned hooks should be functions (generated by our mock)
    expect(typeof result.useListQuery).toBe("function");
    expect(typeof result.useReadQuery).toBe("function");
    expect(typeof result.useCreateMutation).toBe("function");
    expect(typeof result.useUpdateMutation).toBe("function");
    expect(typeof result.useDeleteMutation).toBe("function");
    expect(typeof result.useBulkPatchMutation).toBe("function");
  });

  it("pins list/read/create/update/delete/bulk-patch URLs for String-_id routePath", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminApi(api, "/admin/todos", "Todo"));
    const injected = api.__injected;

    expect(
      injected.adminList_Todo.query({limit: 20, page: 1, q: "Alpha", sort: "-created"})
    ).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/todos?limit=20&page=1&q=Alpha&sort=-created",
    });
    expect(injected.adminRead_Todo.query("todo-alpha")).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/todos/todo-alpha",
    });
    expect(injected.adminCreate_Todo.query({title: "New"})).toEqual({
      body: {title: "New"},
      headers: undefined,
      method: "POST",
      url: "/admin/todos",
    });
    expect(injected.adminUpdate_Todo.query({body: {completed: true}, id: "todo-alpha"})).toEqual({
      body: {completed: true},
      headers: undefined,
      method: "PATCH",
      url: "/admin/todos/todo-alpha",
    });
    expect(injected.adminDelete_Todo.query("todo-alpha")).toEqual({
      headers: undefined,
      method: "DELETE",
      url: "/admin/todos/todo-alpha",
    });
    expect(
      injected.adminBulkPatch_Todo.query({ids: ["todo-alpha"], patch: {completed: true}})
    ).toEqual({
      body: {ids: ["todo-alpha"], patch: {completed: true}},
      headers: undefined,
      method: "POST",
      url: "/admin/todos/bulk-patch",
    });
    expect(typeof result.useBulkPatchMutation).toBe("function");
  });
});

describe("useAdminApi organization switches", () => {
  // A real RTK Query store whose server answers with the organization header it was sent.
  const buildStore = () => {
    const requests: {orgId?: string; url: string}[] = [];
    const api = createApi({
      baseQuery: async (args: {headers?: Record<string, string>; url: string}) => {
        const orgId = args.headers?.["X-Organization-Id"];
        requests.push({orgId, url: args.url});
        return {data: {_id: "user-1", org: orgId ?? "none"}};
      },
      endpoints: () => ({}),
      reducerPath: "terreno-rtk",
    });
    const store = configureStore({
      middleware: (getDefault) => getDefault({serializableCheck: false}).concat(api.middleware),
      reducer: {[api.reducerPath]: api.reducer},
    });
    return {api, requests, store};
  };

  it("reads the record again for the organization chosen after the first read started", async () => {
    const {api, requests, store} = buildStore();
    let selectOrganization: (organization: {_id: string; name: string}) => void = () => {};
    let latest: {data?: {org?: string}; isLoading?: boolean} = {};
    const Probe: React.FC = () => {
      selectOrganization = useOrgContext().selectOrganization;
      const {useReadQuery} = useAdminApi(api as never, "/admin/users", "User");
      latest = useReadQuery("user-1");
      return null;
    };
    renderWithTheme(
      <Provider store={store}>
        <OrgContextProvider>
          <Probe />
        </OrgContextProvider>
      </Provider>
    );
    await waitFor(() => expect(latest.data?.org).toBe("none"));

    // The org switcher settles on a default organization after the screen's first read.
    act(() => {
      selectOrganization({_id: "org-a", name: "Alpha"});
    });

    await waitFor(() => expect(latest.data?.org).toBe("org-a"));
    expect(latest.isLoading).toBe(false);
    expect(requests).toEqual([
      {orgId: undefined, url: "/admin/users/user-1"},
      {orgId: "org-a", url: "/admin/users/user-1"},
    ]);
  });

  it("keys list and read entries by the organization carried in the argument", () => {
    const api = makeMockApi();
    runHook(() => useAdminApi(api, "/admin/users", "User"));
    const injected = api.__injected;
    const read = injected.adminRead_User;
    const list = injected.adminList_User;

    expect(read.query(adminOrgScopedArg("abc", "org-b"))).toEqual({
      headers: {"X-Organization-Id": "org-b"},
      method: "GET",
      url: "/admin/users/abc",
    });
    expect(callTags(read.providesTags, adminOrgScopedArg("abc", "org-b"))).toEqual([
      {id: "abc", type: "admin_User"},
    ]);
    expect(serializeArgs(read, "adminRead_User", adminOrgScopedArg("abc", "org-b"))).toBe(
      "adminRead_User:org-b:abc"
    );
    expect(list.query(adminOrgScopedArg({limit: 1}, undefined))).toEqual({
      headers: undefined,
      method: "GET",
      url: "/admin/users?limit=1",
    });
    expect(serializeArgs(list, "adminList_User", adminOrgScopedArg({limit: 1}, "org-b"))).toBe(
      'adminList_User:org-b:{"limit":1}'
    );
  });
});

describe("useAdminConfig", () => {
  it("injects adminConfig query and exposes config hook data", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminConfig(api, "/admin"));

    const injected = api.__injected;
    expect(injected.adminConfig).toBeDefined();
    const def = injected.adminConfig;
    expect(def.query()).toEqual({method: "GET", url: "/admin/config"});

    expect(result).toMatchObject({
      config: undefined,
      error: null,
      isLoading: false,
    });
  });
});

describe("useAdminScripts", () => {
  it("injects run/get/cancel task endpoints", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminScripts(api, "/admin"));

    const injected = api.__injected;
    expect(injected.adminRunScript).toBeDefined();
    expect(injected.adminGetScriptTask).toBeDefined();
    expect(injected.adminCancelScriptTask).toBeDefined();
    expect(injected.adminListScriptRuns).toBeDefined();

    const runDef = injected.adminRunScript;
    expect(runDef.query({name: "migrate", wetRun: false})).toEqual({
      method: "POST",
      url: "/admin/scripts/migrate/run?wetRun=false",
    });

    const getDef = injected.adminGetScriptTask;
    expect(getDef.query("task-1")).toEqual({
      method: "GET",
      url: "/admin/scripts/tasks/task-1",
    });
    expect(getDef.providesTags).toEqual(["admin_scriptTask"]);

    const cancelDef = injected.adminCancelScriptTask;
    expect(cancelDef.query("task-1")).toEqual({
      method: "DELETE",
      url: "/admin/scripts/tasks/task-1",
    });
    expect(cancelDef.invalidatesTags).toEqual(["admin_scriptTask", "admin_scriptRuns"]);

    const listDef = injected.adminListScriptRuns;
    expect(listDef.query()).toEqual({
      method: "GET",
      url: "/admin/scripts/runs?page=1&limit=25",
    });
    expect(listDef.query({limit: 10, name: "migrate", page: 2})).toEqual({
      method: "GET",
      url: "/admin/scripts/runs?page=2&limit=10&name=migrate",
    });
    expect(listDef.providesTags).toEqual(["admin_scriptRuns"]);
    expect(typeof result.useRunScriptMutation).toBe("function");
    expect(typeof result.useGetScriptTaskQuery).toBe("function");
    expect(typeof result.useCancelScriptTaskMutation).toBe("function");
    expect(typeof result.useListScriptRunsQuery).toBe("function");
  });

  it("returns safe script hooks when endpoint injection is unavailable", async () => {
    const result = runHook(() => useAdminScripts({} as never, "/admin"));

    // The no-op fallback resolves to an empty object rather than a typed task response.
    const cancelled: unknown = await result.useCancelScriptTaskMutation()[0]("task-1").unwrap();
    expect(cancelled).toEqual({});
    expect(result.useGetScriptTaskQuery("task-1")).toEqual({
      data: undefined,
      error: null,
      isLoading: false,
    });
    expect(result.useListScriptRunsQuery()).toEqual({
      data: undefined,
      error: null,
      isFetching: false,
      isLoading: false,
    });
    expect(
      await result.useRunScriptMutation()[0]({name: "migrate", wetRun: false}).unwrap()
    ).toEqual({taskId: ""});
  });
});

describe("useAdminRoles", () => {
  it("injects RBAC endpoints outside the admin base", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminRoles(api, "/admin"));
    const injected = api.__injected;

    expect(
      injected.adminCreateRbacRole.query({
        displayName: "Operators",
        name: "operator",
        permissions: {todos: ["read"]},
      })
    ).toEqual({
      body: {
        displayName: "Operators",
        name: "operator",
        permissions: {todos: ["read"]},
      },
      method: "POST",
      url: "/rbac/roles",
    });
    expect(injected.adminListRbacRoles.query()).toEqual({method: "GET", url: "/rbac/roles"});
    expect(injected.adminListRbacStatements.query()).toEqual({
      method: "GET",
      url: "/rbac/statements",
    });
    expect(
      injected.adminUpdateRbacRole.query({
        changes: {displayName: "Operators", permissions: {}},
        roleName: "operator/admin",
      })
    ).toEqual({
      body: {displayName: "Operators", permissions: {}},
      method: "PATCH",
      url: "/rbac/roles/operator%2Fadmin",
    });
    expect(typeof result.useCreateRoleMutation).toBe("function");
    expect(typeof result.useListRolesQuery).toBe("function");
    expect(typeof result.useListStatementsQuery).toBe("function");
    expect(typeof result.useUpdateRoleMutation).toBe("function");
  });

  it("uses safe empty hooks when RTK injection is unavailable", async () => {
    const result = runHook(() => useAdminRoles({} as never, "/admin"));

    expect(result.useListRolesQuery()).toMatchObject({data: undefined, isLoading: false});
    expect(result.useListStatementsQuery()).toMatchObject({data: undefined, isLoading: false});
    await expect(
      result.useCreateRoleMutation()[0]({displayName: "x", name: "x", permissions: {}}).unwrap()
    ).rejects.toThrow("Role management API is unavailable");
    await expect(
      result
        .useUpdateRoleMutation()[0]({
          changes: {displayName: "x", permissions: {}},
          roleName: "x",
        })
        .unwrap()
    ).rejects.toThrow("Role management API is unavailable");
    expect(normalizeRoles([{displayName: "x", name: "x"}])).toHaveLength(1);
    expect(normalizeRoles({data: [{displayName: "x", name: "x"}]})).toHaveLength(1);
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeStatements({data: {statements: {todos: ["read"]}}})).toEqual({
      todos: ["read"],
    });
    expect(normalizeStatements(undefined)).toEqual({});
  });
});

describe("useAdminBackgroundTaskMutation", () => {
  it("injects a background-task request at a normalized admin root", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminBackgroundTaskMutation(api, "/admin/"));
    const injected = api.__injected;

    expect(
      injected.adminPostBackgroundTask.query({
        ids: ["todo-1"],
        kind: "bulk-patch",
        resourceRoute: "todos",
      })
    ).toEqual({
      body: {
        ids: ["todo-1"],
        kind: "bulk-patch",
        resourceRoute: "todos",
      },
      method: "POST",
      url: "/admin/background-tasks",
    });
    expect(injected.adminPostBackgroundTask.invalidatesTags).toEqual([]);
    expect(typeof result[0]).toBe("function");
    expect(result[1]).toEqual({isLoading: false});
  });
});

describe("useConfigurationApi", () => {
  it("injects meta/values/update/refresh-secrets endpoints", () => {
    const api = makeMockApi();
    const result = runHook(() => useConfigurationApi({api, basePath: "/admin/configuration"}));

    const injected = api.__injected;
    expect(injected.configMeta).toBeDefined();
    expect(injected.configValues).toBeDefined();
    expect(injected.configUpdate).toBeDefined();
    expect(injected.configRefreshSecrets).toBeDefined();
    expect(api.__tagTypes).toContain("configuration");

    expect(injected.configMeta.query()).toEqual({
      method: "GET",
      url: "/admin/configuration/meta",
    });
    expect(injected.configValues.query()).toEqual({
      method: "GET",
      url: "/admin/configuration",
    });
    expect(injected.configValues.providesTags).toEqual(["configuration"]);
    expect(injected.configUpdate.query({a: 1})).toEqual({
      body: {a: 1},
      method: "PATCH",
      url: "/admin/configuration",
    });
    expect(injected.configUpdate.invalidatesTags).toEqual(["configuration"]);
    expect(injected.configRefreshSecrets.query()).toEqual({
      method: "POST",
      url: "/admin/configuration/refresh-secrets",
    });

    expect(typeof result.useMetaQuery).toBe("function");
    expect(typeof result.useValuesQuery).toBe("function");
    expect(typeof result.useUpdateMutation).toBe("function");
    expect(typeof result.useRefreshSecretsMutation).toBe("function");
  });
});

describe("useDocumentStorageApi", () => {
  it("injects list/upload/download/delete/folder endpoints", () => {
    const api = makeMockApi();
    const result = runHook(() => useDocumentStorageApi(api, "/documents"));

    const injected = api.__injected;
    expect(injected.documentStorageList).toBeDefined();
    expect(injected.documentStorageUpload).toBeDefined();
    expect(injected.documentStorageDownload).toBeDefined();
    expect(injected.documentStorageDelete).toBeDefined();
    expect(injected.documentStorageDeleteFolder).toBeDefined();
    expect(injected.documentStorageCreateFolder).toBeDefined();

    const listDef = injected.documentStorageList;
    expect(listDef.query()).toEqual({
      method: "GET",
      params: {},
      url: "/documents/",
    });
    expect(listDef.query("my/folder")).toEqual({
      method: "GET",
      params: {prefix: "my/folder"},
      url: "/documents/",
    });
    expect(listDef.providesTags).toEqual(["documentStorage"]);

    // Upload appends prefix to formData when provided
    const uploadDef = injected.documentStorageUpload;
    const fd: {append: (k: string, v: string) => void; entries: string[]} = {
      append(k: string, v: string) {
        this.entries.push(`${k}=${v}`);
      },
      entries: [],
    };
    const uploadWithPrefix = uploadDef.query({
      formData: fd as unknown as FormData,
      prefix: "sub/",
    });
    expect(uploadWithPrefix).toMatchObject({
      method: "POST",
      url: "/documents/",
    });
    expect(fd.entries).toContain("prefix=sub/");

    const fd2: {append: (k: string, v: string) => void; entries: string[]} = {
      append(k: string, v: string) {
        this.entries.push(`${k}=${v}`);
      },
      entries: [],
    };
    uploadDef.query({formData: fd2 as unknown as FormData});
    expect(fd2.entries.length).toBe(0);

    // Download returns a URL with encoded path and a responseHandler
    const downloadDef = injected.documentStorageDownload;
    const dlSpec = downloadDef.query("my folder/file.pdf");
    expect(dlSpec.url).toBe("/documents/download/my%20folder%2Ffile.pdf");
    expect(dlSpec.method).toBe("GET");
    expect(typeof dlSpec.responseHandler).toBe("function");
    const responseHandler = dlSpec.responseHandler;
    if (!responseHandler) {
      throw new Error("download endpoint has no responseHandler");
    }

    // responseHandler returns the blob on ok
    const okBlob = {size: 5, type: "text/plain"};
    const okResp = {
      blob: async () => okBlob,
      headers: {get: () => "text/plain"},
      ok: true,
      status: 200,
      statusText: "OK",
    };
    return responseHandler(okResp).then(async (blob: unknown) => {
      expect(blob).toBe(okBlob);

      // non-ok JSON response
      const errJson = '{"detail":"Bad","status":400}';
      const jsonResp = {
        headers: {get: () => "application/json"},
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => errJson,
      };
      const parsed = await responseHandler(jsonResp);
      expect(parsed).toEqual({detail: "Bad", status: 400});

      // non-ok non-JSON response (fallback)
      const textResp = {
        headers: {get: () => "text/plain"},
        ok: false,
        status: 500,
        statusText: "err",
        text: async () => "boom",
      };
      const textParsed = await responseHandler(textResp);
      expect(textParsed).toEqual({detail: "boom", status: 500});

      // Delete endpoints
      const deleteDef = injected.documentStorageDelete;
      expect(deleteDef.query("a b.pdf")).toEqual({
        method: "DELETE",
        url: "/documents/a%20b.pdf",
      });
      const deleteFolderDef = injected.documentStorageDeleteFolder;
      expect(deleteFolderDef.query("subdir/")).toEqual({
        method: "DELETE",
        url: "/documents/folder/subdir%2F",
      });

      const createDef = injected.documentStorageCreateFolder;
      expect(createDef.query({folderName: "new", prefix: "a/"})).toEqual({
        body: {folderName: "new", prefix: "a/"},
        method: "POST",
        url: "/documents/folder",
      });

      // Hooks exposed
      expect(typeof result.useListQuery).toBe("function");
      expect(typeof result.useUploadMutation).toBe("function");
      expect(typeof result.useLazyDownloadQuery).toBe("function");
      expect(typeof result.useDeleteMutation).toBe("function");
      expect(typeof result.useDeleteFolderMutation).toBe("function");
      expect(typeof result.useCreateFolderMutation).toBe("function");
    });
  });
});

describe("useAdminBackgroundTaskMutation", () => {
  it("posts to the background-tasks collection under the admin root", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminBackgroundTaskMutation(api as never, "/admin/"));
    const injected = api.__injected;
    expect(injected.adminPostBackgroundTask.query({ids: ["a"], kind: "reindex"})).toEqual({
      body: {ids: ["a"], kind: "reindex"},
      method: "POST",
      url: "/admin/background-tasks",
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("useAdminRoles", () => {
  it("falls back to no-op hooks when injectEndpoints is missing", async () => {
    const result = runHook(() => useAdminRoles({} as never, "/admin"));
    await expect(
      result.useCreateRoleMutation()[0]({displayName: "A", name: "a", permissions: {}}).unwrap()
    ).rejects.toThrow(/unavailable/);
    expect(result.useListRolesQuery()).toMatchObject({data: undefined, isLoading: false});
    expect(result.useListStatementsQuery()).toMatchObject({data: undefined, isLoading: false});
  });

  it("injects rbac list and mutation endpoints at the API root", () => {
    const api = makeMockApi();
    const result = runHook(() => useAdminRoles(api as never, "/v1/admin"));
    const injected = api.__injected;
    expect(injected.adminListRbacRoles.query()).toEqual({method: "GET", url: "/v1/rbac/roles"});
    expect(injected.adminListRbacStatements.query()).toEqual({
      method: "GET",
      url: "/v1/rbac/statements",
    });
    expect(
      injected.adminCreateRbacRole.query({displayName: "A", name: "a", permissions: {}})
    ).toEqual({
      body: {displayName: "A", name: "a", permissions: {}},
      method: "POST",
      url: "/v1/rbac/roles",
    });
    expect(
      injected.adminUpdateRbacRole.query({
        changes: {displayName: "B", permissions: {}},
        roleName: "a b",
      })
    ).toEqual({
      body: {displayName: "B", permissions: {}},
      method: "PATCH",
      url: "/v1/rbac/roles/a%20b",
    });
    expect(typeof result.useListRolesQuery).toBe("function");
    expect(typeof result.useUpdateRoleMutation).toBe("function");
  });
});
