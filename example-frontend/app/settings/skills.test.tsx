import {afterEach, beforeEach, describe, it, spyOn} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {setTokenSource} from "@terreno/rtk";
import {TerrenoProvider} from "@terreno/ui";
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

    const note = await waitFor(() => view!.getByTestId("skills-hidden-note-house-style"));
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

    await waitFor(() => view!.getByTestId("skills-empty"));
    fireEvent.press(view.getByTestId("skills-new-button"));
    fireEvent.changeText(view.getByTestId("skills-form-name-input"), "Bad Name");
    fireEvent.changeText(view.getByTestId("skills-form-description-input"), "A description");
    fireEvent.changeText(view.getByTestId("skills-form-instructions-input"), "Some instructions");
    await act(async (): Promise<void> => {
      fireEvent.press(view!.getByTestId("skills-form-save-button"));
    });

    const error = await waitFor(() => view!.getByTestId("skills-form-error"));
    assert.include(
      JSON.stringify(error.props.children ?? error.children ?? ""),
      "Skill name must be lowercase letters and hyphens"
    );
  });

  it("shows skills-empty when the list is empty", async () => {
    stubFetch(() => json(200, {data: [], limit: 100, more: false, page: 1, total: 0}));
    view = renderSkills();
    await waitFor(() => view!.getByTestId("skills-empty"));
  });
});
