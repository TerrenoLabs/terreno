import {afterEach, describe, it, mock} from "bun:test";
import {TerrenoAccountSecurityScreen} from "@terreno/syncdb/auth";
import {assert} from "chai";
import React from "react";
import TestRenderer, {act, type ReactTestRenderer} from "react-test-renderer";

import {betterAuthClient, getSecurityCallbackURL, OAUTH_PROVIDER_LABELS} from "@/lib/betterAuth";

import SecurityScreen from "./security";

interface FakeRouter {
  back: ReturnType<typeof mock>;
  canGoBack: ReturnType<typeof mock>;
  replace: ReturnType<typeof mock>;
}

const fakeRouter = ({canGoBack}: {canGoBack: boolean}): FakeRouter => ({
  back: mock(() => {}),
  canGoBack: mock(() => canGoBack),
  replace: mock((_href: string) => {}),
});

const renderScreen = async (
  router: FakeRouter,
  params: Record<string, string> = {}
): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer | undefined;
  // Async act lets the screen's sign-in methods request settle before assertions.
  await act(async () => {
    renderer = TestRenderer.create(
      <SecurityScreen
        dependencies={{useLinkError: () => params.error, useSecurityRouter: () => router}}
      />
    );
  });
  if (!renderer) {
    throw new Error("security screen did not render");
  }
  return renderer;
};

const pressBack = (renderer: ReactTestRenderer): void => {
  const {header} = renderer.root.findByType(TerrenoAccountSecurityScreen).props;
  let headerRenderer: ReactTestRenderer | undefined;
  act(() => {
    headerRenderer = TestRenderer.create(header);
  });
  const backButton = headerRenderer?.root.findByProps({testID: "security-screen-back-button"});
  act(() => {
    backButton?.props.onClick();
  });
  act(() => {
    headerRenderer?.unmount();
  });
};

describe("SecurityScreen", () => {
  let mounted: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      mounted?.unmount();
    });
    mounted = undefined;
  });

  it("wires the account security screen to the app's Better Auth client and return URL", async () => {
    mounted = await renderScreen(fakeRouter({canGoBack: true}));

    const props = mounted.root.findByType(TerrenoAccountSecurityScreen).props;
    assert.equal(props.client, betterAuthClient);
    assert.equal(props.callbackURL, getSecurityCallbackURL());
    assert.equal(props.providerLabels, OAUTH_PROVIDER_LABELS);
    assert.equal(props.testID, "security-screen");
    assert.isUndefined(props.linkError);
  });

  it("passes a failed link's ?error= through for the screen to explain", async () => {
    mounted = await renderScreen(fakeRouter({canGoBack: true}), {error: "account_already_linked"});

    assert.equal(
      mounted.root.findByType(TerrenoAccountSecurityScreen).props.linkError,
      "account_already_linked"
    );
  });

  it("goes back when there is history", async () => {
    const router = fakeRouter({canGoBack: true});
    mounted = await renderScreen(router);

    pressBack(mounted);

    assert.equal(router.back.mock.calls.length, 1);
    assert.equal(router.replace.mock.calls.length, 0);
  });

  it("goes to the profile tab when a provider redirect opened the page fresh", async () => {
    const router = fakeRouter({canGoBack: false});
    mounted = await renderScreen(router);

    pressBack(mounted);

    assert.equal(router.back.mock.calls.length, 0);
    assert.deepEqual(router.replace.mock.calls, [["/(tabs)/profile"]]);
  });

  it("reads the router and link error from expo-router by default", async () => {
    await act(async () => {
      mounted = TestRenderer.create(<SecurityScreen />);
    });

    assert.equal(
      mounted?.root.findByType(TerrenoAccountSecurityScreen).props.client,
      betterAuthClient
    );
  });
});
