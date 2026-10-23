import {afterEach, describe, expect, it} from "bun:test";

import {handoffFreePath, holdHandoffUrl, restoreHeldOAuthHandoffUrl} from "./oauthHandoffUrl";

describe("handoffFreePath", () => {
  it("drops handoff from the query and ott from the fragment", () => {
    expect(
      handoffFreePath({hash: "#ott=t0ken", pathname: "/login", search: "?handoff=n0nce"})
    ).toBe("/login");
  });

  it("drops an ott planted in the query", () => {
    expect(handoffFreePath({hash: "", pathname: "/login", search: "?ott=planted"})).toBe("/login");
  });

  it("drops percent-encoded keys", () => {
    expect(
      handoffFreePath({hash: "#%6Ftt=t0ken", pathname: "/login", search: "?hand%6Fff=n"})
    ).toBe("/login");
  });

  it("keeps every other part exactly as written", () => {
    expect(
      handoffFreePath({
        hash: "#section=a%20b&ott=t0ken",
        pathname: "/login",
        search: "?next=%2Fprofile%3Fa%3D1&handoff=n&error=sign_in_failed",
      })
    ).toBe("/login?next=%2Fprofile%3Fa%3D1&error=sign_in_failed#section=a%20b");
  });

  it("returns null when the URL has no handoff", () => {
    expect(handoffFreePath({hash: "#ottawa=1", pathname: "/login", search: "?next=/"})).toBeNull();
    expect(handoffFreePath({hash: "", pathname: "/", search: ""})).toBeNull();
  });
});

interface FakeWindow {
  history: {replaceState: (state: unknown, title: string, url: string) => void; state: unknown};
  location: {hash: string; href: string; pathname: string; search: string};
}

const installWindow = (href: string): {urls: string[]} => {
  const urls: string[] = [];
  const parsed = new URL(href);
  const fake: FakeWindow = {
    history: {
      replaceState: (_state, _title, url): void => {
        urls.push(url);
      },
      state: null,
    },
    location: {hash: parsed.hash, href, pathname: parsed.pathname, search: parsed.search},
  };
  (globalThis as {window?: unknown}).window = fake;
  return {urls};
};

describe("holdHandoffUrl and restoreHeldOAuthHandoffUrl", () => {
  const hadWindow = "window" in globalThis;
  const previousWindow = (globalThis as {window?: unknown}).window;

  afterEach(() => {
    restoreHeldOAuthHandoffUrl();
    if (hadWindow) {
      (globalThis as {window?: unknown}).window = previousWindow;
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("hides the handoff, then puts the exact URL back once", () => {
    const href = "http://localhost:8082/login?handoff=n&next=%2F#ott=t0ken";
    const {urls} = installWindow(href);

    holdHandoffUrl();
    restoreHeldOAuthHandoffUrl();
    restoreHeldOAuthHandoffUrl();

    expect(urls).toEqual(["/login?next=%2F", href]);
  });

  it("leaves a URL without a handoff alone", () => {
    const {urls} = installWindow("http://localhost:8082/login?error=sign_in_failed");

    holdHandoffUrl();
    restoreHeldOAuthHandoffUrl();

    expect(urls).toEqual([]);
  });
});
