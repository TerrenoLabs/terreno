import {describe, expect, it} from "bun:test";

import type {ObservabilityStatusPayload} from "./aiObservabilityNav";
import {resolvePromptActionPermissions} from "./observabilityPermissions";

const statusWithPermissions = (
  permissions: NonNullable<ObservabilityStatusPayload["permissions"]>
): ObservabilityStatusPayload => ({
  localOn: true,
  permissions,
  plugins: [{capabilities: ["prompts"], id: "local"}],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
});

const operatorPromptPermissions = {
  aiPrompt: {
    create: true,
    list: true,
    playground: true,
    promote: true,
    read: true,
    update: true,
  },
};

describe("resolvePromptActionPermissions", () => {
  it("denies write controls while status is loading", () => {
    expect(
      resolvePromptActionPermissions({
        status: statusWithPermissions(operatorPromptPermissions),
        statusLoading: true,
      })
    ).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
  });

  it("denies write controls when status errored or payload is missing", () => {
    expect(
      resolvePromptActionPermissions({
        statusError: true,
      })
    ).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
    expect(resolvePromptActionPermissions({})).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
  });

  it("denies write controls when permissions are absent on an otherwise valid status", () => {
    expect(
      resolvePromptActionPermissions({
        status: {
          localOn: true,
          plugins: [],
          primaries: {
            datasets: "local",
            experiments: "local",
            prompts: "local",
            reviewQueue: "local",
          },
        },
      })
    ).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
  });

  it("maps read-only prompt grants to hidden write controls", () => {
    expect(
      resolvePromptActionPermissions({
        status: statusWithPermissions({
          aiPrompt: {
            create: false,
            list: true,
            playground: false,
            promote: false,
            read: true,
            update: false,
          },
        }),
      })
    ).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
  });

  it("enables operator controls only when each action is explicitly true", () => {
    expect(
      resolvePromptActionPermissions({
        status: statusWithPermissions(operatorPromptPermissions),
      })
    ).toEqual({
      canCreate: true,
      canPlayground: true,
      canPromote: true,
      canUpdate: true,
    });
  });

  it("allows split grants for update without promote or playground", () => {
    expect(
      resolvePromptActionPermissions({
        status: statusWithPermissions({
          aiPrompt: {
            create: false,
            list: true,
            playground: false,
            promote: false,
            read: true,
            update: true,
          },
        }),
      })
    ).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: true,
    });
  });
  it("requires an explicit permissions map when status is present without loading flags", () => {
    expect(
      resolvePromptActionPermissions({
        status: statusWithPermissions(operatorPromptPermissions),
      })
    ).toEqual({
      canCreate: true,
      canPlayground: true,
      canPromote: true,
      canUpdate: true,
    });
    expect(resolvePromptActionPermissions({status: undefined})).toEqual({
      canCreate: false,
      canPlayground: false,
      canPromote: false,
      canUpdate: false,
    });
  });
});
