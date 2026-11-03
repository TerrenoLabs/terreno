import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {render} from "@testing-library/react-native";
import React from "react";
import {Text} from "react-native";
import {runInAdminSpaRequest, serializeForHtml} from "../src/serverContext";

const SCRIPT_ID = "admin-spa-ssr";
const LOADER_DATA_KEY = "__EXPO_ROUTER_LOADER_DATA__";

const PAYLOAD = {
  adminConfig: {models: [{name: "Todo"}]},
  adminConfigStatus: 200,
  appConfig: {
    brandName: "Terreno Admin",
    primaryColor: "#2563EB",
    providers: ["email"] as Array<"email">,
  },
  basePath: "/console",
  profile: {data: {_id: "u1", admin: true}},
  session: {user: {id: "ba1"}, userId: "ba1"},
};

interface FakeNode {
  removeCount: number;
  textContent: string;
}

const globals = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, {had: boolean; value: unknown}> = {};
let node: FakeNode | undefined;
let lookups = 0;
let scripts: Array<{removed: boolean; textContent: string}> = [];

const setGlobal = (key: string, value: unknown): void => {
  if (!(key in saved)) {
    saved[key] = {had: key in globals, value: globals[key]};
  }
  globals[key] = value;
};

const removeGlobal = (key: string): void => {
  if (!(key in saved)) {
    saved[key] = {had: key in globals, value: globals[key]};
  }
  delete globals[key];
};

/** A browser page whose only element is the shell script, with `getElementById` and `remove`. */
const installBrowser = (textContent: string | null): void => {
  node = textContent === null ? undefined : {removeCount: 0, textContent};
  lookups = 0;
  scripts = [];
  setGlobal("window", globalThis);
  setGlobal("document", {
    getElementById: (id: string): unknown => {
      lookups += 1;
      if (id !== SCRIPT_ID || !node || node.removeCount > 0) {
        return null;
      }
      const current = node;
      return {
        remove: (): void => {
          current.removeCount += 1;
        },
        get textContent(): string {
          return current.textContent;
        },
      };
    },
    querySelectorAll: (selector: string): unknown[] => {
      if (selector !== "script") {
        return [];
      }
      return scripts
        .filter((script) => !script.removed)
        .map((script) => ({
          remove: (): void => {
            script.removed = true;
          },
          textContent: script.textContent,
        }));
    },
  });
};

/** Load a fresh copy of the module: it may keep the payload it read from the page. */
let importCount = 0;
const freshHook = async (): Promise<() => unknown> => {
  importCount += 1;
  const mod = await import(`./ssrPayload.ts?case=${importCount}`);
  return mod.useSsrPayload as () => unknown;
};

const Probe: React.FC<{useHook: () => unknown; out: unknown[]}> = ({out, useHook}) => {
  const payload = useHook();
  out.push(payload);
  return <Text>{payload ? "payload" : "none"}</Text>;
};

beforeEach(() => {
  node = undefined;
});

afterEach(() => {
  for (const [key, entry] of Object.entries(saved)) {
    if (entry.had) {
      globals[key] = entry.value;
    } else {
      delete globals[key];
    }
    delete saved[key];
  }
});

describe("useSsrPayload on the server", () => {
  it("returns the current request's scope, with no DOM globals", async () => {
    removeGlobal("window");
    removeGlobal("document");
    const useHook = await freshHook();
    const out: unknown[] = [];

    runInAdminSpaRequest(PAYLOAD, () => {
      render(<Probe out={out} useHook={useHook} />);
    });

    expect(out[0]).toEqual(PAYLOAD);
  });

  it("returns undefined outside a request scope", async () => {
    removeGlobal("window");
    removeGlobal("document");
    const useHook = await freshHook();
    const out: unknown[] = [];

    render(<Probe out={out} useHook={useHook} />);

    expect(out[0]).toBeUndefined();
  });

  it("two requests in different scopes each read their own payload", async () => {
    removeGlobal("window");
    removeGlobal("document");
    const useHook = await freshHook();
    const seen: unknown[] = [];
    const mine = {...PAYLOAD, session: {user: {id: "a"}, userId: "a"}};
    const theirs = {...PAYLOAD, session: {user: {id: "b"}, userId: "b"}};

    await Promise.all([
      new Promise<void>((resolve) => {
        runInAdminSpaRequest(mine, () => {
          setTimeout(() => {
            render(<Probe out={seen} useHook={useHook} />);
            resolve();
          }, 5);
        });
      }),
      new Promise<void>((resolve) => {
        runInAdminSpaRequest(theirs, () => {
          render(<Probe out={seen} useHook={useHook} />);
          resolve();
        });
      }),
    ]);

    expect((seen[0] as typeof theirs).session.userId).toBe("b");
    expect((seen[1] as typeof mine).session.userId).toBe("a");
  });
});

describe("useSsrPayload in the browser", () => {
  it("reads the embedded script's JSON on the first render, escaped for HTML or not", async () => {
    installBrowser(
      serializeForHtml({...PAYLOAD, appConfig: {...PAYLOAD.appConfig, brandName: "</script><b>&"}})
    );
    const useHook = await freshHook();
    const out: unknown[] = [];

    render(<Probe out={out} useHook={useHook} />);

    expect((out[0] as typeof PAYLOAD).appConfig.brandName).toBe("</script><b>&");
    expect((out[0] as typeof PAYLOAD).session).toEqual(PAYLOAD.session);
  });

  it("reads the script once and removes the node: later lookups find nothing", async () => {
    installBrowser(serializeForHtml(PAYLOAD));
    const useHook = await freshHook();
    const out: unknown[] = [];

    render(
      <>
        <Probe out={out} useHook={useHook} />
        <Probe out={out} useHook={useHook} />
      </>
    );

    expect(out.every((value) => JSON.stringify(value) === JSON.stringify(PAYLOAD))).toBe(true);
    expect(node?.removeCount).toBe(1);
    expect(
      (globals.document as {getElementById: (id: string) => unknown}).getElementById(SCRIPT_ID)
    ).toBeNull();
  });

  describe("router loader data", () => {
    const ENTRIES = (): Record<string, unknown> => ({
      "/login": {},
      "/User": {rpc: {"/admin/users": {data: [{email: "phi@example.com"}]}}},
    });
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    it("keeps the global while entries remain, then deletes it once every entry is consumed", async () => {
      installBrowser(serializeForHtml(PAYLOAD));
      const entries = ENTRIES();
      setGlobal(LOADER_DATA_KEY, entries);
      const useHook = await freshHook();

      render(<Probe out={[]} useHook={useHook} />);

      expect(globals[LOADER_DATA_KEY]).toBeDefined();

      // Routes delete each entry as they read it during hydration.
      for (const key of Object.keys(entries)) {
        delete entries[key];
      }
      await sleep(150);

      expect(globals[LOADER_DATA_KEY]).toBeUndefined();
      expect((globals.window as Record<string, unknown>)[LOADER_DATA_KEY]).toBeUndefined();
    });

    it("deletes the global after the 5 second cap when entries are never consumed", async () => {
      // The shared test setup pins Date.now, so the cap is driven by an explicit clock.
      let now = 1_000_000;
      Date.now = (): number => now;
      installBrowser(serializeForHtml(PAYLOAD));
      setGlobal(LOADER_DATA_KEY, ENTRIES());
      const useHook = await freshHook();

      render(<Probe out={[]} useHook={useHook} />);
      now += 4900;
      await sleep(120);
      expect(globals[LOADER_DATA_KEY]).toBeDefined();

      now += 100;
      await sleep(120);

      expect(globals[LOADER_DATA_KEY]).toBeUndefined();
    });

    it("removes inline scripts that embed the loader data, and only those", async () => {
      installBrowser(serializeForHtml(PAYLOAD));
      scripts = [
        {removed: false, textContent: `window.${LOADER_DATA_KEY} = {"/User": {}}`},
        {removed: false, textContent: "console.info('unrelated')"},
      ];
      setGlobal(LOADER_DATA_KEY, {});
      const useHook = await freshHook();

      render(<Probe out={[]} useHook={useHook} />);

      expect(scripts[0].removed).toBe(true);
      expect(scripts[1].removed).toBe(false);
    });

    it("stops polling when the component unmounts before the data is consumed", async () => {
      installBrowser(serializeForHtml(PAYLOAD));
      const entries = ENTRIES();
      setGlobal(LOADER_DATA_KEY, entries);
      const useHook = await freshHook();

      const view = render(<Probe out={[]} useHook={useHook} />);
      expect(() => view.unmount()).not.toThrow();
      for (const key of Object.keys(entries)) {
        delete entries[key];
      }
      await sleep(150);

      // Polling stopped, so nothing deleted the (now empty) global.
      expect(globals[LOADER_DATA_KEY]).toBeDefined();
    });
  });

  it("returns undefined to a component mounted after the first client render committed", async () => {
    installBrowser(serializeForHtml(PAYLOAD));
    const useHook = await freshHook();
    const first: unknown[] = [];
    const second: unknown[] = [];

    const view = render(<Probe out={first} useHook={useHook} />);
    view.rerender(
      <>
        <Probe out={first} useHook={useHook} />
        <Probe out={second} useHook={useHook} />
      </>
    );

    expect(JSON.stringify(first[0])).toBe(JSON.stringify(PAYLOAD));
    expect(first.every((value) => JSON.stringify(value) === JSON.stringify(PAYLOAD))).toBe(true);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((value) => value === undefined)).toBe(true);
  });

  it("returns undefined when the page has no shell script (dev proxy)", async () => {
    installBrowser(null);
    const useHook = await freshHook();
    const out: unknown[] = [];

    render(<Probe out={out} useHook={useHook} />);

    expect(out[0]).toBeUndefined();
    expect(lookups).toBeGreaterThan(0);
  });

  it("returns undefined, without throwing, when the script holds invalid JSON", async () => {
    installBrowser("{not json");
    const useHook = await freshHook();
    const out: unknown[] = [];

    expect(() => render(<Probe out={out} useHook={useHook} />)).not.toThrow();
    expect(out[0]).toBeUndefined();
  });
});
