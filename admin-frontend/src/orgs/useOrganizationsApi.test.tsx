import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {act, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import {adminOrganizationHeaders} from "./organizationHeaders";
import {type OrganizationsApi, useOrganizationsApi} from "./useOrganizationsApi";

interface FetchCall {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface StubResponse {
  body?: unknown;
  pending?: boolean;
  status?: number;
}

const calls: FetchCall[] = [];
const pendingResolvers: Array<() => void> = [];
/** Responses keyed by `"METHOD url"`; unmatched requests answer `{data: {}}`. */
const routes = new Map<string, StubResponse>();
const originalFetch = globalThis.fetch;

/** Routes the real `useOrganizationsApi` fetch client through `routes`. */
const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: FetchCall = {
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    };
    calls.push(call);
    const {
      body,
      pending,
      status = 200,
    } = routes.get(`${call.method} ${call.url}`) ?? {
      body: {data: {}},
    };
    if (pending) {
      await new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      });
    }
    if (status === 204) {
      return new Response(null, {status});
    }
    return new Response(JSON.stringify(body ?? {}), {
      headers: {"Content-Type": "application/json"},
      status,
    });
  }) as typeof fetch;
};

type HookResults = {
  list: ReturnType<OrganizationsApi["useListQuery"]>;
  members: ReturnType<OrganizationsApi["useMembersQuery"]>;
  mine: ReturnType<OrganizationsApi["useMineQuery"]>;
  read: ReturnType<OrganizationsApi["useReadQuery"]>;
  create: ReturnType<OrganizationsApi["useCreateMutation"]>;
  remove: ReturnType<OrganizationsApi["useDeleteMutation"]>;
  update: ReturnType<OrganizationsApi["useUpdateMutation"]>;
  attach: ReturnType<OrganizationsApi["useMemberAttachMutation"]>;
  removeMember: ReturnType<OrganizationsApi["useMemberRemoveMutation"]>;
  updateMember: ReturnType<OrganizationsApi["useMemberUpdateMutation"]>;
};

const renderOrganizationsApi = ({
  basePath,
  skip = false,
}: {
  basePath?: string;
  skip?: boolean;
}): {current: () => HookResults} => {
  let latest: HookResults | undefined;
  const Probe: React.FC = () => {
    const api = useOrganizationsApi(basePath);
    latest = {
      attach: api.useMemberAttachMutation(),
      create: api.useCreateMutation(),
      list: api.useListQuery(undefined, {skip}),
      members: api.useMembersQuery("org-1", {skip}),
      mine: api.useMineQuery(undefined, {skip}),
      read: api.useReadQuery("org-1", {skip}),
      remove: api.useDeleteMutation(),
      removeMember: api.useMemberRemoveMutation(),
      update: api.useUpdateMutation(),
      updateMember: api.useMemberUpdateMutation(),
    };
    return null;
  };
  renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <Probe />
    </AdminProvider>
  );
  return {
    current: (): HookResults => {
      if (!latest) {
        throw new Error("Probe did not render");
      }
      return latest;
    },
  };
};

const findCall = (method: string, url: string): FetchCall | undefined =>
  calls.find((call) => call.method === method && call.url === url);

const countCalls = (method: string, url: string): number =>
  calls.filter((call) => call.method === method && call.url === url).length;

describe("useOrganizationsApi", () => {
  beforeEach(() => {
    calls.length = 0;
    routes.clear();
    installFetch();
  });

  afterEach(() => {
    for (const resolve of pendingResolvers.splice(0)) {
      resolve();
    }
    globalThis.fetch = originalFetch;
  });

  it("loads list, mine, read, and members with organization headers", async () => {
    routes.set("GET /custom-orgs", {body: {data: [{_id: "org-1"}], limit: 1, more: false}});
    routes.set("GET /custom-orgs/mine", {body: {data: [{_id: "org-1"}]}});
    routes.set("GET /custom-orgs/org-1", {body: {data: {_id: "org-1", name: "Acme"}}});
    routes.set("GET /custom-orgs/org-1/members", {body: {data: [{_id: "membership-1"}]}});
    const hooks = renderOrganizationsApi({basePath: "/custom-orgs"});

    await waitFor(() => {
      expect(hooks.current().members.isLoading).toBe(false);
      expect(hooks.current().read.isLoading).toBe(false);
    });
    expect(hooks.current().list.data).toEqual({data: [{_id: "org-1"}], limit: 1, more: false});
    expect(hooks.current().mine.data).toEqual([{_id: "org-1"}]);
    expect(hooks.current().read.data).toEqual({_id: "org-1", name: "Acme"});
    expect(hooks.current().members.data).toEqual([{_id: "membership-1"}]);
    expect(findCall("GET", "/custom-orgs")?.headers["x-organization-id"]).toBeUndefined();
    expect(findCall("GET", "/custom-orgs/mine")?.headers["x-organization-id"]).toBeUndefined();
    expect(findCall("GET", "/custom-orgs/org-1")?.headers["x-organization-id"]).toBe("org-1");
    expect(findCall("GET", "/custom-orgs/org-1/members")?.headers["x-organization-id"]).toBe(
      "org-1"
    );
  });

  it("omits the organization header when no organization id is given", () => {
    expect(adminOrganizationHeaders(undefined)).toBeUndefined();
    expect(adminOrganizationHeaders("org-1")).toEqual({"X-Organization-Id": "org-1"});
  });

  it("skips queries when asked and defaults the base path to /orgs", async () => {
    const hooks = renderOrganizationsApi({skip: true});
    await act(async () => {});

    expect(calls).toHaveLength(0);
    expect(hooks.current().list.isLoading).toBe(false);
  });

  it("sends organization mutations and refetches organization queries", async () => {
    const hooks = renderOrganizationsApi({});
    await waitFor(() => {
      expect(hooks.current().list.isLoading).toBe(false);
    });
    const listCallsBefore = countCalls("GET", "/orgs");

    await act(async () => {
      await hooks.current().create[0]({name: "Acme"}).unwrap();
    });
    expect(findCall("POST", "/orgs")?.body).toEqual({name: "Acme"});

    await act(async () => {
      await hooks
        .current()
        .update[0]({body: {name: "Acme 2"}, id: "org-1"})
        .unwrap();
    });
    expect(findCall("PATCH", "/orgs/org-1")).toMatchObject({
      body: {name: "Acme 2"},
      headers: {"x-organization-id": "org-1"},
    });

    await act(async () => {
      await hooks.current().remove[0]("org-1").unwrap();
    });
    expect(findCall("DELETE", "/orgs/org-1")).toBeDefined();

    await waitFor(() => {
      expect(countCalls("GET", "/orgs")).toBeGreaterThan(listCallsBefore);
    });
  });

  it("sends membership mutations with the organization header and refetches members", async () => {
    const hooks = renderOrganizationsApi({});
    await waitFor(() => {
      expect(hooks.current().members.isLoading).toBe(false);
    });
    const memberCallsBefore = countCalls("GET", "/orgs/org-1/members");

    await act(async () => {
      await hooks
        .current()
        .attach[0]({body: {email: "a@b.com"}, id: "org-1"})
        .unwrap();
    });
    expect(findCall("POST", "/orgs/org-1/members")).toMatchObject({
      body: {email: "a@b.com"},
      headers: {"x-organization-id": "org-1"},
    });

    await act(async () => {
      await hooks
        .current()
        .updateMember[0]({body: {roleName: "member"}, id: "org-1", memberId: "membership-1"})
        .unwrap();
    });
    expect(findCall("PATCH", "/orgs/org-1/members/membership-1")).toMatchObject({
      body: {roleName: "member"},
      headers: {"x-organization-id": "org-1"},
    });

    await act(async () => {
      await hooks
        .current()
        .removeMember[0]({body: {}, id: "org-1", memberId: "membership-1"})
        .unwrap();
    });
    const removeCall = findCall("DELETE", "/orgs/org-1/members/membership-1");
    expect(removeCall?.headers["x-organization-id"]).toBe("org-1");
    expect(removeCall?.body).toBeUndefined();

    await waitFor(() => {
      expect(countCalls("GET", "/orgs/org-1/members")).toBeGreaterThan(memberCallsBefore);
    });
  });

  it("unwraps single-document mutation responses", async () => {
    routes.set("POST /orgs", {body: {data: {_id: "org-9", name: "Nine"}}});
    const hooks = renderOrganizationsApi({skip: true});
    let created: unknown;

    await act(async () => {
      created = await hooks.current().create[0]({name: "Nine"}).unwrap();
    });
    expect(created).toEqual({_id: "org-9", name: "Nine"});
  });
});
