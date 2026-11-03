import {describe, expect, it} from "bun:test";
import {buildAdminReadUrl} from "./adminModelUrls";
import * as adminFrontend from "./index";

describe("buildAdminReadUrl", () => {
  it("appends an ObjectId unchanged", () => {
    expect(buildAdminReadUrl("/admin/users", "65f1a2b3c4d5e6f708192a3b")).toBe(
      "/admin/users/65f1a2b3c4d5e6f708192a3b"
    );
  });

  it("appends a plain id unchanged", () => {
    expect(buildAdminReadUrl("/admin/todos", "todo-1_x.y")).toBe("/admin/todos/todo-1_x.y");
  });

  it("encodes a slash in the id", () => {
    expect(buildAdminReadUrl("/admin/users", "a/b")).toBe("/admin/users/a%2Fb");
  });

  it("encodes query, hash, space and percent characters in the id", () => {
    expect(buildAdminReadUrl("/admin/users", "a b?c#d%e")).toBe("/admin/users/a%20b%3Fc%23d%25e");
  });

  it("does not encode the route path", () => {
    expect(buildAdminReadUrl("/admin/org-members", "x")).toBe("/admin/org-members/x");
  });

  it("is exported from the package entry", () => {
    expect(adminFrontend.buildAdminReadUrl).toBe(buildAdminReadUrl);
  });
});
