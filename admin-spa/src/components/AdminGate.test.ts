import {describe, expect, it} from "bun:test";
import {isForbiddenAdminConfigError} from "../../components/adminGateUtils";

describe("isForbiddenAdminConfigError", () => {
  it("returns true only for authenticated 403 responses", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(true);
  });

  it("returns false for non-403 statuses", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Server error"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 500,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Rate limited"},
        isAuthenticated: true,
        isConfigLoading: false,
        status: 429,
      })
    ).toBe(false);
  });

  it("returns false when status is unknown", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Network issue"},
        isAuthenticated: true,
        isConfigLoading: false,
      })
    ).toBe(false);
  });

  it("returns false when unauthenticated, loading, or no error", () => {
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: false,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: {message: "Forbidden"},
        isAuthenticated: true,
        isConfigLoading: true,
        status: 403,
      })
    ).toBe(false);
    expect(
      isForbiddenAdminConfigError({
        error: undefined,
        isAuthenticated: true,
        isConfigLoading: false,
        status: 403,
      })
    ).toBe(false);
  });
});
