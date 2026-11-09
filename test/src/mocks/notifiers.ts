import {type Mock, mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

type NotifierMock = Mock<(...args: unknown[]) => Promise<void>>;

export interface TerrenoNotifierMocks {
  sendToGoogleChat: NotifierMock;
  sendToSlack: NotifierMock;
  sendToZoom: NotifierMock;
  /** Clears calls and overrides; the notifiers resolve `undefined` again. */
  reset: () => void;
}

/**
 * Re-registers `@terreno/api` with its real exports plus mocked `sendToSlack`, `sendToZoom`,
 * and `sendToGoogleChat`, so app code that imports them sends nothing and tests can assert the
 * calls. Call it in a preload before app modules load.
 *
 * Only importers of the `@terreno/api` package see the mocks: code inside `@terreno/api` that
 * calls the notifiers through its own modules (for example `wrapScript`) still uses the real
 * ones, which no-op without webhook env vars. `@terreno/api` must be installed; it is loaded at
 * runtime because `@terreno/api` depends on this package.
 */
export const registerTerrenoNotifierMocks = (): TerrenoNotifierMocks => {
  const group = createMockGroup();
  const sendToGoogleChat = group.fn(async (..._args: unknown[]): Promise<void> => {});
  const sendToSlack = group.fn(async (..._args: unknown[]): Promise<void> => {});
  const sendToZoom = group.fn(async (..._args: unknown[]): Promise<void> => {});

  // Runtime-only so @terreno/test compiles without @terreno/api (which depends on it).
  const actual = require("@terreno/api") as Record<string, unknown>;
  mock.module("@terreno/api", () => ({...actual, sendToGoogleChat, sendToSlack, sendToZoom}));

  return {reset: group.reset, sendToGoogleChat, sendToSlack, sendToZoom};
};
