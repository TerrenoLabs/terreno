import {describe, expect, it} from "bun:test";
import {orgsSsrRequests} from "../../server/orgsRoutes";

/**
 * The literals are the requests the orgs screens make on mount, read from the real hooks:
 * - directory: `OrgDirectoryScreen.tsx:50-53` -> `useOrganizationsApi.useListQuery`
 *   (`useOrganizationsApi.ts:77-84`): `GET /orgs`, no headers, skipped unless `isOperator`.
 * - settings: `OrgSettingsScreen.tsx:38-39` -> `useReadQuery` (`useOrganizationsApi.ts:140-148`):
 *   `GET /orgs/{id}` with `adminOrganizationHeaders(id)` (`X-Organization-Id: {id}`).
 * - members: `OrgMembersScreen.tsx:78-83` -> `useMembersQuery` (`useOrganizationsApi.ts:110-118`):
 *   `GET /orgs/{id}/members` with `X-Organization-Id: {id}`.
 * - the id is used as the hook uses it (decoded, not re-encoded).
 * - `useMemberSecurityApi` (`useMemberSecurityApi.ts`) is NOT a mount read of any of these
 *   routes: `MemberSecurityPanel` mounts only after "Security" is clicked on a member row, so no
 *   `/security` URL is requested.
 * - `/orgs/mine` is requested by the shell's `OrgSwitcher` (`AdminSpaShell.tsx`), not by these
 *   screens: a loader may seed it, so it is the one extra URL allowed below.
 */
const ORG_HEADER = "X-Organization-Id";
const urlsOf = (requests: {url: string}[]): string[] => requests.map((request) => request.url);
const withoutMine = (requests: {url: string}[]): {url: string}[] =>
  requests.filter((request) => request.url !== "/orgs/mine");

describe("orgsSsrRequests /orgs", () => {
  it("an operator requests the organization list, with no organization header", () => {
    const requests = orgsSsrRequests("/orgs", {isOperator: true});
    expect(withoutMine(requests)).toEqual([{url: "/orgs"}]);
    expect(requests).toContainEqual({url: "/orgs"});
  });

  it("a non-operator gets nothing: the directory screen does not fetch for them", () => {
    expect(orgsSsrRequests("/orgs", {isOperator: false})).toEqual([]);
    expect(orgsSsrRequests("/orgs", {isOperator: false, orgId: "o1"})).toEqual([]);
  });

  it("ignores an orgId: the list is not organization-scoped", () => {
    expect(withoutMine(orgsSsrRequests("/orgs", {isOperator: true, orgId: "o1"}))).toEqual([
      {url: "/orgs"},
    ]);
  });

  it("only asks for /orgs URLs outside the security routes", () => {
    for (const url of urlsOf(orgsSsrRequests("/orgs", {isOperator: true}))) {
      expect(url === "/orgs" || url === "/orgs/mine").toBe(true);
    }
  });
});

describe("orgsSsrRequests /orgs/[orgId]", () => {
  it("requests the organization with its X-Organization-Id", () => {
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]", {isOperator: true, orgId: "o1"}))).toEqual([
      {headers: {[ORG_HEADER]: "o1"}, url: "/orgs/o1"},
    ]);
  });

  it("an org admin who is not an operator still reads their organization", () => {
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]", {isOperator: false, orgId: "o1"}))).toEqual(
      [{headers: {[ORG_HEADER]: "o1"}, url: "/orgs/o1"}]
    );
  });

  it("builds the URL and header from the decoded id, as the hook does (no re-encoding)", () => {
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]", {isOperator: true, orgId: "a b"}))).toEqual(
      [{headers: {[ORG_HEADER]: "a b"}, url: "/orgs/a b"}]
    );
  });

  it("requests nothing for a missing or empty orgId", () => {
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]", {isOperator: true}))).toEqual([]);
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]", {isOperator: true, orgId: ""}))).toEqual(
      []
    );
  });
});

describe("orgsSsrRequests /orgs/[orgId]/members", () => {
  it("requests the members with the same X-Organization-Id the hook sends", () => {
    const requests = orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true, orgId: "o1"});
    expect(requests).toContainEqual({headers: {[ORG_HEADER]: "o1"}, url: "/orgs/o1/members"});
  });

  it("requests exactly the members read (no /security URL: the panel mounts on click)", () => {
    const requests = orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true, orgId: "o1"});
    expect(withoutMine(requests)).toEqual([
      {headers: {[ORG_HEADER]: "o1"}, url: "/orgs/o1/members"},
    ]);
    expect(urlsOf(requests).some((url) => url.includes("/security"))).toBe(false);
  });

  it("an org admin who is not an operator still reads their members", () => {
    expect(
      orgsSsrRequests("/orgs/[orgId]/members", {isOperator: false, orgId: "o1"})
    ).toContainEqual({headers: {[ORG_HEADER]: "o1"}, url: "/orgs/o1/members"});
  });

  it("builds the URL and header from the decoded id (no re-encoding)", () => {
    expect(
      orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true, orgId: "a b"})
    ).toContainEqual({headers: {[ORG_HEADER]: "a b"}, url: "/orgs/a b/members"});
  });

  it("requests nothing for a missing or empty orgId", () => {
    expect(withoutMine(orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true}))).toEqual([]);
    expect(
      withoutMine(orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true, orgId: ""}))
    ).toEqual([]);
  });
});

describe("orgsSsrRequests id guard", () => {
  it.each(["../../admin/config", "o1/members", "o1?x=1", "o1#x", "o1\\x"])(
    "seeds nothing for an orgId that is not one path segment: %s",
    (orgId) => {
      expect(orgsSsrRequests("/orgs/[orgId]", {isOperator: true, orgId})).toEqual([]);
      expect(orgsSsrRequests("/orgs/[orgId]/members", {isOperator: true, orgId})).toEqual([]);
    }
  );
});
