import {describe, expect, it} from "bun:test";

import {exampleFeatureFlagSegments} from "./featureFlagSegments";

describe("exampleFeatureFlagSegments", () => {
  it("matches admin users", () => {
    expect(exampleFeatureFlagSegments["admin-users"]({admin: true})).toBe(true);
    expect(exampleFeatureFlagSegments["admin-users"]({admin: false})).toBe(false);
  });

  it("matches users who have a name", () => {
    expect(exampleFeatureFlagSegments["has-name"]({name: "Ada"})).toBe(true);
    expect(exampleFeatureFlagSegments["has-name"]({})).toBe(false);
  });

  it("matches oauth users", () => {
    expect(exampleFeatureFlagSegments["oauth-users"]({oauthProvider: "google"})).toBe(true);
    expect(exampleFeatureFlagSegments["oauth-users"]({})).toBe(false);
  });
});
