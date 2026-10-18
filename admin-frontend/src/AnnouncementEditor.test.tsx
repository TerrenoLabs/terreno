// noExplicitAny: test mocks use type-erased admin model API doubles and UNSAFE_root traversal
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";

interface State {
  formData: Record<string, unknown> | null;
  isFormLoading: boolean;
}
const state: State = {formData: null, isFormLoading: false};
const createCalls: unknown[] = [];
const updateCalls: unknown[] = [];
const publishCalls: string[] = [];
const archiveCalls: string[] = [];
let createImpl: (body: unknown) => Promise<unknown> = async (b) => ({
  _id: "new-id",
  ...(b as Record<string, unknown>),
});
let updateImpl: (args: unknown) => Promise<unknown> = async (a) => ({
  _id: (a as Record<string, unknown>).id,
});
let publishImpl: (id: string) => Promise<unknown> = async () => ({data: {status: "published"}});
let archiveImpl: (id: string) => Promise<unknown> = async () => ({data: {status: "archived"}});

const requests: Array<{method: string; url: string}> = [];
interface ConfigState {
  data: {defaultAcknowledgementPolicy?: string} | undefined;
  error: boolean;
  isLoading: boolean;
}
const configState: ConfigState = {data: undefined, error: false, isLoading: false};
const pendingConfig: Array<() => void> = [];
const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

const respondConfig = (): Response => {
  if (configState.error) {
    return jsonResponse({title: "config unavailable"}, 500);
  }
  return jsonResponse({data: configState.data ?? {}});
};

const respondAction = async (
  impl: (id: string) => Promise<unknown>,
  calls: string[],
  id: string
): Promise<Response> => {
  calls.push(id);
  try {
    return jsonResponse(await impl(id));
  } catch (error) {
    return jsonResponse({title: (error as Error).message}, 500);
  }
};

const installFetch = (): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({method, url: String(url)});
    if (url === "/announcements/config") {
      if (configState.isLoading) {
        return await new Promise<Response>((resolve) => {
          pendingConfig.push(() => resolve(respondConfig()));
        });
      }
      return respondConfig();
    }
    const action = /^\/announcements\/([^/]+)\/(publish|archive)$/.exec(String(url));
    if (method === "POST" && action) {
      const [, id, verb] = action;
      return verb === "publish"
        ? respondAction(publishImpl, publishCalls, id as string)
        : respondAction(archiveImpl, archiveCalls, id as string);
    }
    return jsonResponse({title: "not found"}, 404);
  }) as typeof fetch;
};

const releaseConfig = (): void => {
  for (const resolve of pendingConfig.splice(0)) {
    resolve();
  }
};

type EditorProps = React.ComponentProps<typeof AnnouncementEditor>;

/** AnnouncementEditor bound to the admin fetch client. */
const Editor: React.FC<EditorProps> = (props) => (
  <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
    <AnnouncementEditor {...props} />
  </AdminProvider>
);

import {AnnouncementEditor} from "./AnnouncementEditor";

const press = async (el: ReactTestInstance): Promise<void> => {
  await act(async () => {
    fireEvent.press(el);
    await new Promise((r) => setTimeout(r, 150));
  });
};

describe("AnnouncementEditor", () => {
  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useCreateMutation: () => [
        (body: unknown) => ({
          unwrap: async () => {
            createCalls.push(body);
            return createImpl(body);
          },
        }),
        {isLoading: false},
      ],
      useReadQuery: (_id: string, opts: {skip?: boolean}) => {
        if (opts?.skip) {
          return {data: undefined, isLoading: false};
        }
        return {data: state.formData, isLoading: state.isFormLoading};
      },
      useUpdateMutation: () => [
        (args: unknown) => ({
          unwrap: async () => {
            updateCalls.push(args);
            return updateImpl(args);
          },
        }),
        {isLoading: false},
      ],
    });
    state.formData = null;
    state.isFormLoading = false;
    createCalls.length = 0;
    updateCalls.length = 0;
    publishCalls.length = 0;
    archiveCalls.length = 0;
    requests.length = 0;
    pendingConfig.length = 0;
    configState.data = undefined;
    configState.error = false;
    configState.isLoading = false;
    installFetch();
    createImpl = async (b) => ({_id: "new-id", ...(b as Record<string, unknown>)});
    updateImpl = async (a) => ({_id: (a as Record<string, unknown>).id});
    publishImpl = async () => ({data: {status: "published"}});
    archiveImpl = async () => ({data: {status: "archived"}});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders loading state in edit mode", () => {
    state.isFormLoading = true;
    const {toJSON} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    expect(toJSON()).toBeDefined();
  });

  it("survives the loading → loaded transition without a hook-order error", async () => {
    state.isFormLoading = true;
    const {rerender, getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await act(async () => {
      state.isFormLoading = false;
      state.formData = {
        audience: {tiers: ["all"]},
        body: "Body",
        platforms: ["web"],
        priority: 1,
        requiresAcknowledgement: true,
        status: "draft",
        title: "Loaded",
        version: 1,
      };
      rerender(<Editor baseUrl="/admin" id="a1" />);
    });
    expect(getByTestId("announcement-title-input")).toBeDefined();
  });

  it("renders create mode with default values", () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    expect(getByTestId("announcement-title-input")).toBeDefined();
  });

  it("fails validation without title or body", async () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(0);
  });

  it("creates an announcement on save", async () => {
    const onSave = mock((_: unknown) => undefined);
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" onSave={onSave} />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Hello");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "World");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(1);
    expect((createCalls[0] as Record<string, unknown>).title).toBe("Hello");
    expect((createCalls[0] as Record<string, unknown>).status).toBe("draft");
    expect(onSave).toHaveBeenCalled();
  });

  it("loads form data in edit mode and saves an update", async () => {
    state.formData = {
      audience: {},
      body: "Body",
      platforms: ["ios", "web"],
      priority: 2,
      requiresAcknowledgement: false,
      status: "draft",
      title: "Draft",
      version: 1,
    };
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-save-button"));
    expect(updateCalls.length).toBe(1);
    expect((updateCalls[0] as Record<string, unknown>).id).toBe("a1");
    const updateBody = (updateCalls[0] as Record<string, unknown>).body as Record<string, unknown>;
    expect(updateBody.status).toBeUndefined();
    expect(updateBody.title).toBe("Draft");
  });

  it("publishes a draft announcement", async () => {
    state.formData = {body: "B", status: "draft", title: "T"};
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-publish-button"));
    expect(publishCalls).toEqual(["a1"]);
  });

  it("archives a published announcement", async () => {
    state.formData = {body: "B", status: "published", title: "T", version: 1};
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-archive-button"));
    expect(archiveCalls).toEqual(["a1"]);
  });

  it("rejects invalid audience JSON", async () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      fireEvent.changeText(getByTestId("announcement-audience-input"), "{bad json");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(0);
  });

  it("posts publish and archive to the announcement action URLs", async () => {
    state.formData = {body: "B", status: "draft", title: "T"};
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-publish-button"));
    state.formData = {body: "B", status: "published", title: "T", version: 1};
    const archiveView = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(archiveView.getByTestId("announcement-archive-button"));
    const posts = requests.filter((request) => request.method === "POST");
    expect(posts.map((request) => request.url)).toEqual([
      "/announcements/a1/publish",
      "/announcements/a1/archive",
    ]);
  });

  it("invokes onCancel from the cancel button", async () => {
    const onCancel = mock(() => undefined);
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" onCancel={onCancel} />);
    await press(getByTestId("announcement-cancel-button"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows published and archived status labels in edit mode", async () => {
    state.formData = {
      body: "Body",
      status: "published",
      title: "Published title",
      version: 3,
    };
    const published = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    expect(published.getByText("Published (v3)")).toBeDefined();

    state.formData = {body: "Body", status: "archived", title: "Archived title", version: 2};
    const archived = renderWithTheme(<Editor baseUrl="/admin" id="a2" />);
    expect(archived.getByText("Archived")).toBeDefined();
  });

  it("creates announcements with a primary action", async () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      fireEvent.changeText(getByTestId("announcement-primary-label-input"), "Read more");
      fireEvent.changeText(
        getByTestId("announcement-primary-url-input"),
        "https://example.com/docs"
      );
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(
      (createCalls[0] as {primaryAction?: {label: string; url: string}}).primaryAction
    ).toEqual({
      label: "Read more",
      url: "https://example.com/docs",
    });
  });

  it("surfaces create failures without throwing", async () => {
    createImpl = async () => {
      throw new Error("create failed");
    };
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(1);
  });

  it("surfaces archive failures without throwing", async () => {
    archiveImpl = async () => {
      throw new Error("archive failed");
    };
    state.formData = {body: "B", status: "published", title: "T", version: 1};
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-archive-button"));
    expect(archiveCalls).toEqual(["a1"]);
  });

  it("surfaces publish failures without throwing", async () => {
    publishImpl = async () => {
      throw new Error("publish failed");
    };
    state.formData = {body: "B", status: "draft", title: "T"};
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-publish-button"));
    expect(publishCalls).toEqual(["a1"]);
  });

  it("fails validation when the body is empty", async () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title only");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(0);
  });

  it("rejects a partial primary action", async () => {
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      fireEvent.changeText(getByTestId("announcement-primary-label-input"), "Learn more");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(0);
  });

  it("updates delivery platforms through the multiselect field", async () => {
    const {getByLabelText, getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.press(getByLabelText("iOS"));
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    const platforms = (createCalls[0] as {platforms?: string[]}).platforms ?? [];
    assert.deepEqual(platforms, ["android", "web"]);
  });

  it("requires at least one platform before save", async () => {
    const {getByLabelText, getByTestId} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "Title");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      await new Promise((r) => setTimeout(r, 50));
    });
    for (const label of ["iOS", "Android", "Web"]) {
      await act(async () => {
        fireEvent.press(getByLabelText(label));
        await new Promise((r) => setTimeout(r, 50));
      });
    }
    await press(getByTestId("announcement-save-button"));
    expect(createCalls.length).toBe(0);
    expect(getByTestId("announcement-platforms-input.error")).toBeDefined();
  });

  it("ignores invalid schedule dates when loading an announcement", async () => {
    state.formData = {
      body: "Body",
      expiresAt: "not-a-date",
      publishAt: "also-invalid",
      status: "draft",
      title: "Scheduled",
    };
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await press(getByTestId("announcement-save-button"));
    expect(updateCalls.length).toBe(1);
    expect(getByTestId("announcement-title-input")).toBeDefined();
  });

  it("wires the config query to GET /announcements/config", async () => {
    renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(requests[0], {method: "GET", url: "/announcements/config"});
  });

  it("skips the config query in edit mode", async () => {
    state.formData = {body: "B", status: "draft", title: "T"};
    renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.lengthOf(requests, 0);
  });

  it("pre-fills acknowledgement policy from plugin config on create", async () => {
    configState.data = {defaultAcknowledgementPolicy: "required"};
    const {UNSAFE_root} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const policySelect = UNSAFE_root.findAllByType(SelectField).find(
      (node: ReactTestInstance) => node.props.testID === "announcement-acknowledgement-policy-input"
    );
    assert.equal(policySelect?.props.value, "required");
  });

  it("defaults acknowledgement policy to dismiss-only when config fetch fails", async () => {
    configState.error = true;
    const {UNSAFE_root} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const policySelect = UNSAFE_root.findAllByType(SelectField).find(
      (node: ReactTestInstance) => node.props.testID === "announcement-acknowledgement-policy-input"
    );
    assert.equal(policySelect?.props.value, "dismiss-only");
  });

  it("does not overwrite user-changed acknowledgement policy when config arrives late", async () => {
    configState.isLoading = true;
    const {UNSAFE_root, rerender} = renderWithTheme(<Editor baseUrl="/admin" />);
    const policySelect = () =>
      UNSAFE_root.findAllByType(SelectField).find(
        (node: ReactTestInstance) =>
          node.props.testID === "announcement-acknowledgement-policy-input"
      );
    await act(async () => {
      policySelect()?.props.onChange("required");
      await new Promise((r) => setTimeout(r, 50));
    });
    configState.isLoading = false;
    configState.data = {defaultAcknowledgementPolicy: "dismiss-only"};
    await act(async () => {
      releaseConfig();
      rerender(<Editor baseUrl="/admin" />);
      await new Promise((r) => setTimeout(r, 50));
    });
    assert.equal(policySelect()?.props.value, "required");
  });

  it("loads structured targeting fields in edit mode", async () => {
    state.formData = {
      acknowledgementPolicy: "required",
      audienceType: "staff",
      body: "Body",
      displayMode: "banner",
      minBuildNumber: 42,
      platforms: ["web"],
      priority: 2,
      status: "draft",
      title: "Staff banner",
      version: 1,
    };
    const {UNSAFE_root} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const selectByTestId = (testID: string): ReactTestInstance | undefined =>
      UNSAFE_root.findAllByType(SelectField).find(
        (node: ReactTestInstance) => node.props.testID === testID
      );
    assert.equal(selectByTestId("announcement-display-mode-input")?.props.value, "banner");
    assert.equal(selectByTestId("announcement-audience-type-input")?.props.value, "staff");
    assert.equal(
      selectByTestId("announcement-acknowledgement-policy-input")?.props.value,
      "required"
    );
    const minBuild = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props.testID === "announcement-min-build-input"
    )[0];
    assert.equal(minBuild?.props.value, "42");
  });

  it("persists structured targeting fields on create without requiresAcknowledgement", async () => {
    configState.data = {defaultAcknowledgementPolicy: "dismiss-only"};
    const {getByTestId, UNSAFE_root} = renderWithTheme(<Editor baseUrl="/admin" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-title-input"), "New");
      fireEvent.changeText(getByTestId("announcement-body-input-input"), "Body");
      UNSAFE_root.findAllByType(SelectField)
        .find((node: ReactTestInstance) => node.props.testID === "announcement-display-mode-input")
        ?.props.onChange("banner");
      UNSAFE_root.findAllByType(SelectField)
        .find((node: ReactTestInstance) => node.props.testID === "announcement-audience-type-input")
        ?.props.onChange("patient");
      UNSAFE_root.findAllByType(SelectField)
        .find(
          (node: ReactTestInstance) =>
            node.props.testID === "announcement-acknowledgement-policy-input"
        )
        ?.props.onChange("required");
      fireEvent.changeText(getByTestId("announcement-min-build-input"), "10");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    assert.equal(createCalls.length, 1);
    const payload = createCalls[0] as Record<string, unknown>;
    assert.equal(payload.displayMode, "banner");
    assert.equal(payload.audienceType, "patient");
    assert.equal(payload.acknowledgementPolicy, "required");
    assert.equal(payload.minBuildNumber, 10);
    assert.isUndefined(payload.requiresAcknowledgement);
  });

  it("omits status on edit save and clears minBuildNumber with null", async () => {
    state.formData = {
      acknowledgementPolicy: "dismiss-only",
      audience: {},
      audienceType: "all",
      body: "Body",
      displayMode: "modal",
      minBuildNumber: 5,
      platforms: ["ios", "web"],
      priority: 2,
      status: "published",
      title: "Draft",
      version: 1,
    };
    const {getByTestId} = renderWithTheme(<Editor baseUrl="/admin" id="a1" />);
    await act(async () => {
      fireEvent.changeText(getByTestId("announcement-min-build-input"), "");
      await new Promise((r) => setTimeout(r, 50));
    });
    await press(getByTestId("announcement-save-button"));
    assert.equal(updateCalls.length, 1);
    const updateBody = (updateCalls[0] as Record<string, unknown>).body as Record<string, unknown>;
    assert.isUndefined(updateBody.status);
    assert.equal(updateBody.displayMode, "modal");
    assert.equal(updateBody.audienceType, "all");
    assert.equal(updateBody.acknowledgementPolicy, "dismiss-only");
    assert.isNull(updateBody.minBuildNumber);
    assert.isUndefined(updateBody.requiresAcknowledgement);
  });
});
