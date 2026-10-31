import {afterEach, beforeEach, describe, it, spyOn} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {setTokenSource} from "@terreno/rtk";
import {FilePickerButton, Modal, TerrenoProvider} from "@terreno/ui";
import {act, fireEvent, type RenderResult, render, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import type {ReactNode} from "react";
import {SafeAreaProvider} from "react-native-safe-area-context";
import {Provider} from "react-redux";

import {terrenoApi} from "@/store/sdk";

import SkillsScreen from "./skills";

const SAFE_AREA_METRICS = {
  frame: {height: 844, width: 390, x: 0, y: 0},
  insets: {bottom: 0, left: 0, right: 0, top: 0},
};

interface SkillRow {
  _id: string;
  created: string;
  description: string;
  instructions: string;
  name: string;
  scope: "user" | "global";
  updated: string;
}

const skill = (name: string, scope: "user" | "global", id: string): SkillRow => ({
  _id: id,
  created: "2026-10-30T12:00:00.000Z",
  description: `${name} description`,
  instructions: `${name} instructions`,
  name,
  scope,
  updated: "2026-10-30T12:00:00.000Z",
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {"content-type": "application/json"},
    status,
  });

const makeStore = (): ReturnType<typeof configureStore> =>
  configureStore({
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(terrenoApi.middleware),
    reducer: {
      betterAuth: (state: {userId: string | null} = {userId: null}): {userId: string | null} =>
        state,
      [terrenoApi.reducerPath]: terrenoApi.reducer,
    },
  });

const renderSkills = (): RenderResult => {
  const store = makeStore();
  const Wrapper: React.FC<{children: ReactNode}> = ({children}) => (
    <Provider store={store}>
      <TerrenoProvider>
        <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
      </TerrenoProvider>
    </Provider>
  );
  return render(<SkillsScreen />, {wrapper: Wrapper});
};

const stubFetch = (handler: (request: Request) => Response): void => {
  spyOn(globalThis, "fetch").mockImplementation(
    (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      handler(new Request(input as RequestInfo, init))) as typeof fetch
  );
};

describe("SkillsScreen", () => {
  let view: RenderResult | undefined;

  const rendered = (): RenderResult => {
    if (!view) {
      throw new Error("renderSkills() has not run");
    }
    return view;
  };

  beforeEach(() => {
    view = undefined;
    // The app registers its Better Auth source in store/index; without one, rtk's JWT source
    // finds no stored token and the request never reaches fetch.
    setTokenSource({
      getToken: async (): Promise<string | null> => "test-token",
      getUserId: async (): Promise<string | null> => "user-1",
      onAuthChange: (): (() => void) => (): void => {},
    });
  });

  afterEach(() => {
    setTokenSource(undefined);
    view?.unmount();
    (globalThis.fetch as unknown as {mockRestore?: () => void}).mockRestore?.();
  });

  it("shows skills-hidden-note on a user skill hidden by a same-name global skill", async () => {
    stubFetch(() =>
      json(200, {
        data: [skill("house-style", "global", "g1"), skill("house-style", "user", "u1")],
        limit: 100,
        more: false,
        page: 1,
        total: 2,
      })
    );
    view = renderSkills();

    const note = await waitFor(() => rendered().getByTestId("skills-hidden-note-house-style"));
    const texts = JSON.stringify(note.props.children ?? note.children ?? "");
    assert.include(texts, "Hidden by a skill for everyone");
    assert.exists(view.getByTestId("skills-global-badge-house-style"));
  });

  it("shows the API error title in skills-form-error when saving fails", async () => {
    stubFetch((request) => {
      if (request.method === "POST") {
        return json(400, {status: 400, title: "Skill name must be lowercase letters and hyphens"});
      }
      return json(200, {data: [], limit: 100, more: false, page: 1, total: 0});
    });
    view = renderSkills();

    await waitFor(() => rendered().getByTestId("skills-empty"));
    fireEvent.press(view.getByTestId("skills-new-button"));
    fireEvent.changeText(view.getByTestId("skills-form-name-input"), "Bad Name");
    fireEvent.changeText(view.getByTestId("skills-form-description-input"), "A description");
    fireEvent.changeText(view.getByTestId("skills-form-instructions-input"), "Some instructions");
    await act(async (): Promise<void> => {
      fireEvent.press(rendered().getByTestId("skills-form-save-button"));
    });

    const error = await waitFor(() => rendered().getByTestId("skills-form-error"));
    assert.include(
      JSON.stringify(error.props.children ?? error.children ?? ""),
      "Skill name must be lowercase letters and hyphens"
    );
  });

  it("shows skills-empty when the list is empty", async () => {
    stubFetch(() => json(200, {data: [], limit: 100, more: false, page: 1, total: 0}));
    view = renderSkills();
    await waitFor(() => rendered().getByTestId("skills-empty"));
  });
  it("shows the API error title in skills-list-error when the list fails", async () => {
    stubFetch(() => json(400, {status: 400, title: "Skills are unavailable"}));
    view = renderSkills();
    const error = await waitFor(() => rendered().getByTestId("skills-list-error"), {timeout: 8000});
    assert.include(JSON.stringify(error.props.children ?? ""), "Skills are unavailable");
  });

  it("closes the form on cancel and on a successful save", async () => {
    const posted: unknown[] = [];
    stubFetch((request) => {
      if (request.method === "POST") {
        return json(201, {data: skill("new-one", "user", "n1")});
      }
      return json(200, {data: [], limit: 100, more: false, page: 1, total: 0});
    });
    spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const request = new Request(input as RequestInfo, init);
      if (request.method === "POST") {
        posted.push(await request.json());
        return json(201, {data: skill("new-one", "user", "n1")});
      }
      return json(200, {data: [], limit: 100, more: false, page: 1, total: 0});
    }) as typeof fetch);
    view = renderSkills();
    await waitFor(() => rendered().getByTestId("skills-empty"));

    fireEvent.press(view.getByTestId("skills-new-button"));
    fireEvent.press(view.getByTestId("skills-form-cancel-button"));
    assert.isNull(view.queryByTestId("skills-form-name-input"));

    fireEvent.press(view.getByTestId("skills-new-button"));
    fireEvent.changeText(view.getByTestId("skills-form-name-input"), "new-one");
    fireEvent.changeText(view.getByTestId("skills-form-description-input"), "A description");
    fireEvent.changeText(view.getByTestId("skills-form-instructions-input"), "Do the thing");
    await act(async (): Promise<void> => {
      fireEvent.press(rendered().getByTestId("skills-form-save-button"));
    });

    await waitFor(() => assert.isNull(rendered().queryByTestId("skills-form-name-input")));
    assert.deepEqual(posted, [
      {description: "A description", instructions: "Do the thing", name: "new-one"},
    ]);
  });

  it("lets an admin install an uploaded skill for everyone", async () => {
    const uploads: string[] = [];
    stubFetch((request) => {
      if (request.url.includes("/auth/me")) {
        return json(200, {_id: "admin-1", admin: true, email: "admin@example.com", id: "admin-1"});
      }
      return json(200, {
        data: [skill("team-style", "global", "g1")],
        limit: 100,
        more: false,
        page: 1,
        total: 1,
      });
    });
    (globalThis.fetch as unknown as {mockImplementation: (fn: unknown) => void}).mockImplementation(
      (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input as RequestInfo, init);
        if (request.url.includes("/auth/me")) {
          return json(200, {
            _id: "admin-1",
            admin: true,
            email: "admin@example.com",
            id: "admin-1",
          });
        }
        if (request.method === "POST") {
          uploads.push(await request.text());
          return json(201, {data: skill("uploaded", "global", "g2")});
        }
        return json(200, {
          data: [skill("team-style", "global", "g1")],
          limit: 100,
          more: false,
          page: 1,
          total: 1,
        });
      }) as typeof fetch
    );
    view = renderSkills();

    // An admin may delete a global skill, so its delete button renders.
    await waitFor(() => rendered().getByTestId("skills-delete-button-team-style"));
    fireEvent(view.getByTestId("skills-form-global-switch"), "onChange", true);
    const picker = view.UNSAFE_getByType(FilePickerButton);
    await act(async (): Promise<void> => {
      await picker.props.onFilesSelected([
        {mimeType: "text/markdown", name: "SKILL.md", uri: "file:///SKILL.md"},
      ]);
    });

    await waitFor(() => assert.lengthOf(uploads, 1));
    // The native test runtime serializes FormData, so match the scope part in either encoding.
    assert.match(uploads[0], /scope"?\W{1,8}global/);
    assert.isNull(view.queryByTestId("skills-error"));
  });

  it("shows skills-error when an upload fails and ignores an empty selection", async () => {
    stubFetch((request) => {
      if (request.method === "POST") {
        return json(400, {status: 400, title: "SKILL.md is missing a name"});
      }
      return json(200, {data: [], limit: 100, more: false, page: 1, total: 0});
    });
    view = renderSkills();
    await waitFor(() => rendered().getByTestId("skills-empty"));
    const picker = view.UNSAFE_getByType(FilePickerButton);

    await act(async (): Promise<void> => {
      await picker.props.onFilesSelected([]);
    });
    assert.isNull(view.queryByTestId("skills-error"));

    await act(async (): Promise<void> => {
      await picker.props.onFilesSelected([
        {mimeType: "text/markdown", name: "SKILL.md", uri: "file:///SKILL.md"},
      ]);
    });
    const error = await waitFor(() => rendered().getByTestId("skills-error"));
    assert.include(JSON.stringify(error.props.children ?? ""), "SKILL.md is missing a name");
  });

  it("deletes a skill after confirming and shows skills-error when the delete fails", async () => {
    const deleted: string[] = [];
    let failDelete = false;
    stubFetch((request) => {
      if (request.method === "DELETE") {
        deleted.push(request.url);
        return failDelete
          ? json(403, {status: 403, title: "Not your skill"})
          : new Response(null, {status: 204});
      }
      return json(200, {
        data: [skill("mine", "user", "u1")],
        limit: 100,
        more: false,
        page: 1,
        total: 1,
      });
    });
    view = renderSkills();
    await waitFor(() => rendered().getByTestId("skills-delete-button-mine"));

    // Cancelling the confirmation deletes nothing.
    fireEvent.press(view.getByTestId("skills-delete-button-mine"));
    await act(async (): Promise<void> => {
      rendered().UNSAFE_getByType(Modal).props.secondaryButtonOnClick();
    });
    assert.lengthOf(deleted, 0);

    fireEvent.press(view.getByTestId("skills-delete-button-mine"));
    await act(async (): Promise<void> => {
      await rendered().UNSAFE_getByType(Modal).props.primaryButtonOnClick();
    });
    await waitFor(() => assert.lengthOf(deleted, 1));
    assert.include(deleted[0], "/gpt/skills/u1");

    failDelete = true;
    fireEvent.press(view.getByTestId("skills-delete-button-mine"));
    await act(async (): Promise<void> => {
      await rendered().UNSAFE_getByType(Modal).props.primaryButtonOnClick();
    });
    const error = await waitFor(() => rendered().getByTestId("skills-error"));
    assert.include(JSON.stringify(error.props.children ?? ""), "Not your skill");
  });

  it("goes back from skills-back-button", async () => {
    stubFetch(() => json(200, {data: [], limit: 100, more: false, page: 1, total: 0}));
    view = renderSkills();
    await waitFor(() => rendered().getByTestId("skills-empty"));
    fireEvent.press(view.getByTestId("skills-back-button"));
  });
});
