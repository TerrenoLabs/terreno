/**
 * Isolated: runs with `ADMIN_USE_REAL_API=1` (see scripts/run-tests.sh) so the real
 * `useAdminModelApi` and `useAdminRpcQuery` run under `AdminModelForm`. Proves an edit form under
 * an `AdminRpcSeed` shows the record's values on the very first render (no effect-driven second
 * render) and asks for no read, refetches the read once after a save, and, unseeded, keeps today's
 * spinner-then-fill behavior.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {TextInput} from "react-native";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: mock(() => {})},
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
}));

const userConfig: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "User",
      fieldOrder: ["email", "name"],
      fields: {
        _id: {required: true, type: "string"},
        email: {required: true, type: "string"},
        name: {required: false, type: "string"},
      },
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
  scripts: [],
};

mock.module("../useAdminConfig", () => ({
  useAdminConfig: () => ({config: userConfig, error: null, isLoading: false}),
}));

// Records every value a field is rendered with, so the first render is observable: the test
// renderer flushes effects before it returns, which would hide a one-render-late form state.
const fieldRenders: {fieldKey: string; value: unknown}[] = [];
mock.module("../AdminFieldRenderer", () => ({
  AdminFieldRenderer: ({
    fieldKey,
    onChange,
    value,
  }: {
    fieldKey: string;
    onChange: (value: string) => void;
    value: unknown;
  }) => {
    fieldRenders.push({fieldKey, value});
    return (
      <TextInput
        onChangeText={onChange}
        testID={`admin-field-${fieldKey}`}
        value={typeof value === "string" ? value : ""}
      />
    );
  },
}));

import {AdminModelForm} from "../AdminModelForm";
import {AdminProvider} from "../AdminProvider";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";

const READ_URL = "/admin/users/u1";
const originalFetch = globalThis.fetch;
const record = {_id: "u1", email: "ada@example.com", name: "Ada"};

const stubFetch = (calls: string[]): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(JSON.stringify({data: record}), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderForm = (seed?: Record<string, unknown>): ReturnType<typeof renderWithTheme> => {
  const form = (
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="">
      <AdminModelForm apiBase="/admin" itemId="u1" mode="edit" modelName="User" routeBase="" />
    </AdminProvider>
  );
  return renderWithTheme(seed ? <AdminRpcSeed data={seed}>{form}</AdminRpcSeed> : form);
};

describe("AdminModelForm server seed", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    fieldRenders.length = 0;
  });

  it("shows seeded field values on the first render and requests no read", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const view = renderForm({[adminRpcSeedKey(READ_URL)]: {data: record}});
    // The very first render of each field already carries the seeded value.
    expect(fieldRenders.find((render) => render.fieldKey === "email")?.value).toBe(
      "ada@example.com"
    );
    expect(fieldRenders.find((render) => render.fieldKey === "name")?.value).toBe("Ada");
    expect(view.getByTestId("admin-field-email").props.value).toBe("ada@example.com");
    expect(view.getByTestId("admin-field-name").props.value).toBe("Ada");
    await flush();
    expect(calls).toEqual([]);
  });

  it("keeps the user's edits across later renders of a seeded form", async () => {
    stubFetch([]);
    const view = renderForm({[adminRpcSeedKey(READ_URL)]: {data: record}});
    await act(async () => {
      fireEvent.changeText(view.getByTestId("admin-field-name"), "Grace");
    });
    await flush();
    expect(view.getByTestId("admin-field-name").props.value).toBe("Grace");
  });

  it("refetches the seeded read exactly once after a save", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const view = renderForm({[adminRpcSeedKey(READ_URL)]: {data: record}});
    await act(async () => {
      fireEvent.press(view.getByTestId("admin-save-button"));
    });
    await flush();
    expect(calls).toEqual([`PATCH ${READ_URL}`, `GET ${READ_URL}`]);
  });

  it("edit, save, refetch keeps the edit", async () => {
    stubFetch([]);
    const view = renderForm({[adminRpcSeedKey(READ_URL)]: {data: record}});
    await act(async () => {
      fireEvent.changeText(view.getByTestId("admin-field-name"), "Grace");
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("admin-save-button"));
    });
    await flush();
    await flush();
    // The refetch answered with the pre-edit record; the form must not snap back to it.
    expect(view.getByTestId("admin-field-name").props.value).toBe("Grace");
  });

  it("without a seed, shows a spinner then fills the form from one read (today's behavior)", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    const view = renderForm();
    expect(view.queryByTestId("admin-field-email")).toBeNull();
    await flush();
    await flush();
    expect(calls).toEqual([`GET ${READ_URL}`]);
    expect(view.getByTestId("admin-field-email").props.value).toBe("ada@example.com");
  });
});
