import {useEffect, useState} from "react";
import {type AdminSpaRequestScope, getAdminSpaRequest} from "../src/serverContext";

/** What the server render hands the client shell: the gate's request scope. */
export type AdminSpaShellPayload = AdminSpaRequestScope;

/** Id of the JSON script `+html.tsx` writes the shell payload into. */
export const SSR_PAYLOAD_SCRIPT_ID = "admin-spa-ssr";

/** Where Expo Router keeps route loader data for hydration. */
const LOADER_DATA_KEY = "__EXPO_ROUTER_LOADER_DATA__";

interface ScriptLike {
  remove: () => void;
  textContent: string | null;
}

interface DocumentLike {
  getElementById: (id: string) => ScriptLike | null;
  querySelectorAll?: (selector: string) => ArrayLike<ScriptLike>;
}

/** The payload read from the page, kept so every reader after the first gets the same one. */
let clientPayload: {value: AdminSpaShellPayload | undefined} | undefined;

/**
 * Set once the first client render has committed. The payload describes the page the server
 * rendered, so a component that mounts later (after a sign-in, sign-out or navigation) must
 * read live state instead: a stale session or admin config would contradict it.
 */
let hasHydrated = false;

/**
 * @public Test seam: forget the payload read from the page and the hydration mark, as a fresh
 * page load would. Tests use it instead of re-importing the module, whose copies Bun's coverage
 * would count apart.
 */
export const resetSsrPayloadForTests = (): void => {
  clientPayload = undefined;
  hasHydrated = false;
};

const browserDocument = (): DocumentLike | undefined => {
  return typeof document === "undefined" ? undefined : (document as unknown as DocumentLike);
};

/** Read the payload script once, then remove it so the session and profile leave the DOM. */
const readClientPayload = (doc: DocumentLike): AdminSpaShellPayload | undefined => {
  if (hasHydrated) {
    return undefined;
  }
  if (clientPayload) {
    return clientPayload.value;
  }
  const node = doc.getElementById(SSR_PAYLOAD_SCRIPT_ID);
  let value: AdminSpaShellPayload | undefined;
  if (node?.textContent) {
    try {
      value = JSON.parse(node.textContent) as AdminSpaShellPayload;
    } catch {
      // The parser's message can quote the payload (session, profile), so it is not logged.
      console.warn("[admin-spa] Ignoring an unreadable server payload");
    }
  }
  node?.remove();
  clientPayload = {value};
  return value;
};

/** How often, and for how long, to wait for every route to read its hydration data. */
const LOADER_DATA_POLL_MS = 50;
const LOADER_DATA_MAX_WAIT_MS = 5000;

/**
 * Drop the route loader data Expo embedded for hydration. Loader rows can hold PHI, so they
 * must not stay on `window` or in the DOM after the routes that read them have rendered; a
 * later client navigation fetches its loader JSON instead.
 *
 * Each route reads (and deletes) its own entry while it hydrates, and route bundles hydrate
 * after this layout, so the data is dropped once every entry is consumed. Dropping it earlier
 * makes a route render without its data, which fails hydration and re-renders the page,
 * losing whatever the operator already typed. After `LOADER_DATA_MAX_WAIT_MS` it is dropped
 * regardless.
 */
const clearRouterLoaderData = (doc: DocumentLike): (() => void) => {
  const globals = globalThis as Record<string, unknown>;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    delete globals[LOADER_DATA_KEY];
    const scripts = doc.querySelectorAll?.("script") ?? [];
    for (const script of Array.from(scripts)) {
      if (script.textContent?.includes(LOADER_DATA_KEY)) {
        script.remove();
      }
    }
  };

  const check = (): void => {
    const data = globals[LOADER_DATA_KEY] as Record<string, unknown> | undefined;
    const isConsumed = !data || Object.keys(data).length === 0;
    if (isConsumed || Date.now() - startedAt >= LOADER_DATA_MAX_WAIT_MS) {
      clear();
      return;
    }
    timer = setTimeout(check, LOADER_DATA_POLL_MS);
  };

  check();
  return (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
};

/**
 * The shell payload for this render: the request scope on the server, and the embedded
 * `#admin-spa-ssr` script on the client. Undefined without a server render (dev proxy).
 */
export const useSsrPayload = (): AdminSpaShellPayload | undefined => {
  const doc = browserDocument();
  const [payload] = useState((): AdminSpaShellPayload | undefined =>
    doc ? readClientPayload(doc) : getAdminSpaRequest()
  );

  // Clear hydration data once this tree (and the routes under it) has rendered on the client.
  useEffect(() => {
    if (!doc) {
      return;
    }
    hasHydrated = true;
    return clearRouterLoaderData(doc);
  }, [doc]);

  return payload;
};
