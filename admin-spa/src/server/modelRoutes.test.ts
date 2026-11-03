import {describe, expect, it} from "bun:test";
import {resolveModelListUrl} from "../../server/modelRoutes";

/**
 * The URL `AdminModelTable` requests for default params: page 1, default limit, `defaultSort`.
 * Pinned by admin-frontend/src/isolated/adminModelTable.ssr.isolated.tsx, which records what the
 * rendered table requests, so server and client build the same seed key by construction.
 */
const USER_LIST_URL = "/admin/users?limit=20&page=1&sort=-created";

const adminConfig = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "User",
      fields: {_id: {required: true, type: "string"}, email: {required: false, type: "string"}},
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Todos",
      fields: {_id: {required: true, type: "string"}, title: {required: false, type: "string"}},
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
      syncCollection: "todos",
    },
    {
      displayName: "Sized",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "Sized",
      pageSize: 50,
      routePath: "/admin/sized",
    },
    {
      displayName: "Unrouted",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "Unrouted",
      routePath: "",
    },
  ],
  scripts: [],
};

describe("resolveModelListUrl", () => {
  it("builds the default list URL the table requests for a model name", () => {
    expect(resolveModelListUrl(adminConfig, "User")).toBe(USER_LIST_URL);
  });

  it("returns null for an unknown model name", () => {
    expect(resolveModelListUrl(adminConfig, "Nope")).toBeNull();
  });

  it("matches the model by name, not by display name or route path", () => {
    expect(resolveModelListUrl(adminConfig, "Todos")).toBeNull();
    expect(resolveModelListUrl(adminConfig, "/admin/users")).toBeNull();
  });

  it("still returns the REST membership URL for a windowed sync model", () => {
    expect(resolveModelListUrl(adminConfig, "Todo")).toBe(
      "/admin/todos?limit=20&page=1&sort=-created"
    );
  });

  it("uses the model's page size as the limit and omits sort without a defaultSort", () => {
    expect(resolveModelListUrl(adminConfig, "Sized")).toBe("/admin/sized?limit=50&page=1");
  });

  it("returns null for a model with no route path", () => {
    expect(resolveModelListUrl(adminConfig, "Unrouted")).toBeNull();
  });

  it.each([null, undefined, {}, {models: "x"}, "str", 7])(
    "returns null for a malformed config (%p)",
    (config) => {
      expect(resolveModelListUrl(config, "User")).toBeNull();
    }
  );

  it("returns null for an empty model name", () => {
    expect(resolveModelListUrl(adminConfig, "")).toBeNull();
  });
});
