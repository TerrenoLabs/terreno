import {afterEach, describe, expect, it} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";
import {type AdminMigrationsApi, useAdminMigrations} from "./useAdminMigrations";

interface CapturedRequest {
  method?: string;
  url: string;
}

const originalFetch = globalThis.fetch;

const stubFetch = (captured: CapturedRequest[]): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.push({method: init?.method, url: String(url)});
    const body =
      init?.method === "POST" ? {taskId: "task-1"} : {applied: [], lock: null, pending: []};
    return new Response(JSON.stringify(body), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

describe("useAdminMigrations", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads status and runs migrations under the admin migrations path", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    let status: ReturnType<AdminMigrationsApi["useGetMigrationsQuery"]> | undefined;
    let run: ReturnType<AdminMigrationsApi["useRunMigrationsMutation"]>[0] | undefined;
    const Harness: React.FC = () => {
      const {useGetMigrationsQuery, useRunMigrationsMutation} = useAdminMigrations("/admin");
      status = useGetMigrationsQuery();
      [run] = useRunMigrationsMutation();
      return null;
    };
    renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(status?.data).toEqual({applied: [], lock: null, pending: []});

    let result: unknown;
    await act(async () => {
      result = await run?.({wetRun: true}).unwrap();
    });
    expect(result).toEqual({taskId: "task-1"});
    expect(captured.slice(0, 2)).toEqual([
      {method: "GET", url: "/admin/migrations/status"},
      {method: "POST", url: "/admin/migrations/run?wetRun=true"},
    ]);
    // A run invalidates the status query so the panel refreshes.
    expect(captured[2]).toEqual({method: "GET", url: "/admin/migrations/status"});
  });

  it("skips the status request when asked", async () => {
    const captured: CapturedRequest[] = [];
    stubFetch(captured);
    let status: ReturnType<AdminMigrationsApi["useGetMigrationsQuery"]> | undefined;
    const Harness: React.FC = () => {
      status = useAdminMigrations("/admin").useGetMigrationsQuery(undefined, {skip: true});
      return null;
    };
    renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured).toEqual([]);
    expect(status?.isLoading).toBe(false);
  });
});
