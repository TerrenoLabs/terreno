/**
 * Tests for `useAdminModelApi`, the admin model CRUD hook over the host-bound
 * fetch client. Runs with `ADMIN_USE_REAL_API=1` so the preload double in
 * `src/testing/useAdminModelApiDouble.ts` does not replace the real module.
 */
import {afterEach, describe, expect, it} from "bun:test";
import {act, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import {OrgContextProvider, useOrgContext} from "../orgs/useOrgContext";
import {type AdminModelApi, useAdminModelApi} from "../useAdminModelApi";
import {normalizeRoles, normalizeStatements} from "../useAdminRoles";

interface CapturedRequest {
  body?: unknown;
  headers: Headers;
  method: string;
  url: string;
}

const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

const listEnvelope = {
  data: [{_id: "u1", email: "ada@example.com"}],
  limit: 20,
  more: false,
  page: 1,
  total: 1,
};

const stubFetch = (captured: CapturedRequest[]): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    captured.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
      method,
      url: String(url),
    });
    const path = String(url);
    if (method === "GET" && path.includes("?")) {
      return jsonResponse(listEnvelope);
    }
    if (method === "GET" && path === "/admin/users") {
      return jsonResponse(listEnvelope);
    }
    if (method === "DELETE") {
      return new Response(null, {status: 204});
    }
    if (path.endsWith("/bulk-patch")) {
      return jsonResponse({updated: 2});
    }
    return jsonResponse({data: {_id: "u1", email: "ada@example.com", method}});
  }) as typeof fetch;
};

interface HarnessState {
  api?: AdminModelApi;
  list?: ReturnType<AdminModelApi["useListQuery"]>;
  read?: ReturnType<AdminModelApi["useReadQuery"]>;
  mutations?: {
    bulkPatch: ReturnType<AdminModelApi["useBulkPatchMutation"]>[0];
    create: ReturnType<AdminModelApi["useCreateMutation"]>[0];
    remove: ReturnType<AdminModelApi["useDeleteMutation"]>[0];
    update: ReturnType<AdminModelApi["useUpdateMutation"]>[0];
  };
}

const renderModelApi = ({
  listParams,
  organizationId,
  readId = "u1",
  routePath = "/admin/users",
  skipList = false,
}: {
  listParams?: Record<string, unknown>;
  organizationId?: string;
  readId?: string;
  routePath?: string;
  skipList?: boolean;
}): HarnessState => {
  const state: HarnessState = {};
  const Harness: React.FC = () => {
    const api = useAdminModelApi(routePath, "User");
    state.api = api;
    state.list = api.useListQuery(listParams, {skip: skipList});
    state.read = api.useReadQuery(readId);
    const [create] = api.useCreateMutation();
    const [update] = api.useUpdateMutation();
    const [remove] = api.useDeleteMutation();
    const [bulkPatch] = api.useBulkPatchMutation();
    state.mutations = {bulkPatch, create, remove, update};
    return null;
  };
  const tree = organizationId ? (
    <OrgContextProvider initialOrganization={{_id: organizationId, name: "Org"}}>
      <Harness />
    </OrgContextProvider>
  ) : (
    <Harness />
  );
  renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      {tree}
    </AdminProvider>
  );
  return state;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useAdminModelApi", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists with qs-serialized params and keeps the list envelope", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({
      listParams: {email: {$in: ["a@example.com"]}, limit: 20, page: 2, sort: "-created"},
    });
    await flush();
    const listRequest = captured.find((request) => request.url.startsWith("/admin/users?"));
    expect(listRequest?.method).toBe("GET");
    expect(decodeURIComponent(listRequest?.url ?? "")).toBe(
      "/admin/users?email[$in][0]=a@example.com&limit=20&page=2&sort=-created"
    );
    expect(state.list?.data).toEqual(listEnvelope);
  });

  it("reads one document and unwraps the data envelope", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({skipList: true});
    await flush();
    expect(captured.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /admin/users/u1",
    ]);
    expect(state.read?.data).toEqual({_id: "u1", email: "ada@example.com", method: "GET"});
  });

  it("creates, updates, deletes, and bulk-patches against the model routes", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({skipList: true});
    await flush();
    captured.length = 0;

    let created: unknown;
    let updated: unknown;
    let removed: unknown;
    let patched: unknown;
    await act(async () => {
      created = await state.mutations?.create({email: "new@example.com"}).unwrap();
      updated = await state.mutations
        ?.update({body: {email: "ada@new.example.com"}, id: "u1"})
        .unwrap();
      removed = await state.mutations?.remove("u1").unwrap();
      patched = await state.mutations
        ?.bulkPatch({ids: ["u1", "u2"], patch: {admin: true}})
        .unwrap();
    });

    const writes = captured.filter((request) => request.method !== "GET");
    expect(writes.map(({body, method, url}) => ({body, method, url}))).toEqual([
      {body: {email: "new@example.com"}, method: "POST", url: "/admin/users"},
      {body: {email: "ada@new.example.com"}, method: "PATCH", url: "/admin/users/u1"},
      {body: undefined, method: "DELETE", url: "/admin/users/u1"},
      {
        body: {ids: ["u1", "u2"], patch: {admin: true}},
        method: "POST",
        url: "/admin/users/bulk-patch",
      },
    ]);
    expect(writes[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(created).toEqual({_id: "u1", email: "ada@example.com", method: "POST"});
    expect(updated).toEqual({_id: "u1", email: "ada@example.com", method: "PATCH"});
    expect(removed).toBeUndefined();
    expect(patched).toEqual({updated: 2});
  });

  it("refetches mounted model queries after a write", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({listParams: {limit: 20, page: 1}});
    await flush();
    const readsBefore = captured.filter((request) => request.method === "GET").length;
    expect(readsBefore).toBe(2);

    await act(async () => {
      await state.mutations?.create({email: "new@example.com"}).unwrap();
    });
    await flush();
    const readsAfter = captured.filter((request) => request.method === "GET").length;
    expect(readsAfter).toBe(4);
  });

  it("sends X-Organization-Id for organization-scoped admin", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({organizationId: "org-1", skipList: true});
    await flush();
    await act(async () => {
      await state.mutations?.update({body: {name: "x"}, id: "u1"}).unwrap();
    });
    expect(captured.length).toBeGreaterThanOrEqual(2);
    for (const request of captured) {
      expect(request.headers.get("X-Organization-Id")).toBe("org-1");
    }
  });

  it("reads the record again for the organization chosen after the first read started", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    let selectOrganization: (organization: {_id: string; name: string}) => void = () => {};
    let latest: ReturnType<AdminModelApi["useReadQuery"]> | undefined;
    const Probe: React.FC = () => {
      selectOrganization = useOrgContext().selectOrganization;
      latest = useAdminModelApi("/admin/users", "User").useReadQuery("u1");
      return null;
    };
    renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <OrgContextProvider>
          <Probe />
        </OrgContextProvider>
      </AdminProvider>
    );
    await flush();

    // The org switcher settles on a default organization after the screen's first read.
    act(() => {
      selectOrganization({_id: "org-a", name: "Alpha"});
    });

    await waitFor(() => {
      expect(captured.map((request) => request.headers.get("X-Organization-Id"))).toEqual([
        null,
        "org-a",
      ]);
    });
    expect(latest?.isLoading).toBe(false);
  });

  it("skips requests without a route path or read id", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    const state = renderModelApi({readId: "", routePath: ""});
    await flush();
    expect(captured).toEqual([]);
    expect(state.list?.isLoading).toBe(false);
    expect(state.read?.isLoading).toBe(false);
  });
});

describe("role normalizers", () => {
  it("accept bare arrays and data envelopes", () => {
    expect(normalizeRoles([{displayName: "x", name: "x"}])).toHaveLength(1);
    expect(normalizeRoles({data: [{displayName: "x", name: "x"}]})).toHaveLength(1);
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeStatements({data: {statements: {todos: ["read"]}}})).toEqual({
      todos: ["read"],
    });
    expect(normalizeStatements(undefined)).toEqual({});
  });
});
