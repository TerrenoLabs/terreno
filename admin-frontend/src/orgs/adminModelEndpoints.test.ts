import {describe, it} from "bun:test";
import {assert} from "chai";
import type {EndpointBuilder} from "../types";
import {adminOrganizationHeaders, buildAdminModelEndpoints} from "./adminModelEndpoints";

interface EndpointDefinition {
  invalidatesTags?: string[] | unknown;
  providesTags?: unknown;
  query: (args: unknown) => Record<string, unknown>;
  serializeQueryArgs?: (args: {endpointName: string; queryArgs: unknown}) => string;
}

const build = {
  mutation: (definition: EndpointDefinition): EndpointDefinition => definition,
  query: (definition: EndpointDefinition): EndpointDefinition => definition,
} as unknown as EndpointBuilder;

const buildFoodEndpoints = (organizationId: string | undefined) =>
  buildAdminModelEndpoints(build, {
    headers: adminOrganizationHeaders(organizationId),
    modelName: "Food",
    organizationId,
    routePath: "/admin/foods",
  });

describe("adminModelEndpoints", () => {
  it("omits organization headers when no organization is selected", () => {
    assert.isUndefined(adminOrganizationHeaders(undefined));
  });

  it("sends X-Organization-Id on list, read, and write endpoints", () => {
    const endpoints = buildFoodEndpoints("org-1");
    const list = endpoints.adminList_Food as EndpointDefinition;
    const read = endpoints.adminRead_Food as EndpointDefinition;
    const create = endpoints.adminCreate_Food as EndpointDefinition;
    const update = endpoints.adminUpdate_Food as EndpointDefinition;
    const deleteEndpoint = endpoints.adminDelete_Food as EndpointDefinition;
    const bulkPatch = endpoints.adminBulkPatch_Food as EndpointDefinition;

    assert.deepEqual(list.query(undefined).headers, {"X-Organization-Id": "org-1"});
    assert.deepEqual(list.query({page: 1}).headers, {"X-Organization-Id": "org-1"});
    assert.deepEqual(read.query("food-1").headers, {"X-Organization-Id": "org-1"});
    assert.deepEqual(create.query({name: "Soup"}).headers, {"X-Organization-Id": "org-1"});
    assert.deepEqual(update.query({body: {name: "Stew"}, id: "food-1"}).headers, {
      "X-Organization-Id": "org-1",
    });
    assert.deepEqual(deleteEndpoint.query("food-1").headers, {"X-Organization-Id": "org-1"});
    assert.deepEqual(bulkPatch.query({ids: ["food-1"], patch: {disabled: true}}).headers, {
      "X-Organization-Id": "org-1",
    });
  });

  it("builds every CRUD query and invalidates the collection or row tags", () => {
    const endpoints = buildFoodEndpoints("org-1");
    const list = endpoints.adminList_Food as EndpointDefinition;
    const read = endpoints.adminRead_Food as EndpointDefinition;
    const create = endpoints.adminCreate_Food as EndpointDefinition;
    const update = endpoints.adminUpdate_Food as EndpointDefinition;
    const deleteEndpoint = endpoints.adminDelete_Food as EndpointDefinition;
    const bulkPatch = endpoints.adminBulkPatch_Food as EndpointDefinition;

    assert.deepEqual(list.query(undefined), {
      headers: {"X-Organization-Id": "org-1"},
      method: "GET",
      url: "/admin/foods",
    });
    assert.deepEqual(read.query("food-1"), {
      headers: {"X-Organization-Id": "org-1"},
      method: "GET",
      url: "/admin/foods/food-1",
    });
    assert.deepEqual(create.query({name: "Soup"}), {
      body: {name: "Soup"},
      headers: {"X-Organization-Id": "org-1"},
      method: "POST",
      url: "/admin/foods",
    });
    assert.deepEqual(update.query({body: {name: "Stew"}, id: "food-1"}), {
      body: {name: "Stew"},
      headers: {"X-Organization-Id": "org-1"},
      method: "PATCH",
      url: "/admin/foods/food-1",
    });
    assert.deepEqual(deleteEndpoint.query("food-1"), {
      headers: {"X-Organization-Id": "org-1"},
      method: "DELETE",
      url: "/admin/foods/food-1",
    });
    assert.deepEqual(bulkPatch.query({ids: ["food-1"], patch: {disabled: true}}), {
      body: {ids: ["food-1"], patch: {disabled: true}},
      headers: {"X-Organization-Id": "org-1"},
      method: "POST",
      url: "/admin/foods/bulk-patch",
    });

    assert.deepEqual(list.providesTags, ["admin_Food"]);
    assert.deepEqual(create.invalidatesTags, ["admin_Food"]);
    assert.deepEqual(deleteEndpoint.invalidatesTags, ["admin_Food"]);
    assert.deepEqual(bulkPatch.invalidatesTags, ["admin_Food"]);

    const readProvidesTags = read.providesTags as (
      result: unknown,
      error: unknown,
      id: string
    ) => unknown;
    assert.deepEqual(readProvidesTags(undefined, undefined, "food-1"), [
      {id: "food-1", type: "admin_Food"},
    ]);

    const updateInvalidatesTags = update.invalidatesTags as (
      result: unknown,
      error: unknown,
      args: {id: string}
    ) => unknown;
    assert.deepEqual(updateInvalidatesTags(undefined, undefined, {id: "food-1"}), [
      {id: "food-1", type: "admin_Food"},
      "admin_Food",
    ]);
  });

  it("rebuilds list and read cache keys when the selected organization changes", () => {
    const first = buildFoodEndpoints("org-1");
    const second = buildFoodEndpoints("org-2");
    const firstList = first.adminList_Food as EndpointDefinition;
    const secondList = second.adminList_Food as EndpointDefinition;
    const firstRead = first.adminRead_Food as EndpointDefinition;
    const secondRead = second.adminRead_Food as EndpointDefinition;

    assert.notEqual(
      firstList.serializeQueryArgs?.({endpointName: "adminList_Food", queryArgs: {}}),
      secondList.serializeQueryArgs?.({endpointName: "adminList_Food", queryArgs: {}})
    );
    assert.notEqual(
      firstRead.serializeQueryArgs?.({endpointName: "adminRead_Food", queryArgs: "food-1"}),
      secondRead.serializeQueryArgs?.({endpointName: "adminRead_Food", queryArgs: "food-1"})
    );
    assert.equal(
      firstList.serializeQueryArgs?.({endpointName: "adminList_Food", queryArgs: undefined}),
      "adminList_Food:org-1:{}"
    );
    assert.equal(
      firstRead.serializeQueryArgs?.({endpointName: "adminRead_Food", queryArgs: "food-1"}),
      "adminRead_Food:org-1:food-1"
    );
    assert.equal(
      (buildFoodEndpoints(undefined).adminList_Food as EndpointDefinition).serializeQueryArgs?.({
        endpointName: "adminList_Food",
        queryArgs: undefined,
      }),
      "adminList_Food::{}"
    );
    assert.deepEqual((second.adminList_Food as EndpointDefinition).query({}).headers, {
      "X-Organization-Id": "org-2",
    });
  });
});
