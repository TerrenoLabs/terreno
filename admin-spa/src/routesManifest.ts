import fs from "node:fs";
import path from "node:path";

interface RawRoute {
  page: string;
  namedRegex: string;
  [key: string]: unknown;
}

/** The parts of an Expo server build's `_expo/routes.json` the serve plugin reads. */
export interface RawRoutesManifest {
  assets?: {js?: string[]};
  htmlRoutes?: RawRoute[];
  apiRoutes?: RawRoute[];
  notFoundRoutes?: RawRoute[];
  redirects?: RawRoute[];
  rewrites?: RawRoute[];
  pageHeaders?: RawRoute[];
  [key: string]: unknown;
}

const REGEX_LISTS = [
  "htmlRoutes",
  "apiRoutes",
  "notFoundRoutes",
  "redirects",
  "rewrites",
  "pageHeaders",
] as const;

/** Read `_expo/routes.json` from a server build, or undefined when there is no build. */
export const readRoutesManifest = (serverDir: string): RawRoutesManifest | undefined => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(serverDir, "_expo", "routes.json"), "utf-8")
    ) as RawRoutesManifest;
  } catch {
    return undefined;
  }
};

/**
 * The baseUrl baked into the build, read from its asset URLs (`/console/_expo/static/...`).
 * "" for a bundle built for the site root.
 */
export const bakedBaseUrlOf = (manifest: RawRoutesManifest): string => {
  const firstAsset = manifest.assets?.js?.[0] ?? "";
  const index = firstAsset.indexOf("/_expo/");
  return index > 0 ? firstAsset.slice(0, index) : "";
};

/** Expo Router's match priority for one path segment: static, then dynamic, then catch-all. */
const segmentRank = (segment: string): number => {
  if (segment.startsWith("[...")) {
    return 2;
  }
  if (segment.startsWith("[")) {
    return 1;
  }
  return 0;
};

const routeRanks = (page: string): number[] => {
  return page
    .split("/")
    .filter((segment) => segment !== "" && !(segment.startsWith("(") && segment.endsWith(")")))
    .map(segmentRank);
};

/** Compare two routes segment by segment: the more specific route sorts first. */
const compareSpecificity = (a: RawRoute, b: RawRoute): number => {
  const aRanks = routeRanks(a.page);
  const bRanks = routeRanks(b.page);
  const length = Math.min(aRanks.length, bRanks.length);
  for (let index = 0; index < length; index++) {
    const difference = (aRanks[index] ?? 0) - (bRanks[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

/**
 * Prepare the manifest the way expo-server's environment does (regex strings become
 * `RegExp`s), with HTML routes ordered by specificity. Expo 58 exports `routes.json`
 * unsorted, and expo-server takes the first regex match, so `/[model]` would shadow `/login`
 * and render it without its loader data. The router itself already prefers static routes.
 */
export const prepareRoutesManifest = (raw: RawRoutesManifest): Record<string, unknown> => {
  const prepared: Record<string, unknown> = {...raw};
  for (const list of REGEX_LISTS) {
    const routes = raw[list];
    if (!routes) {
      // expo-server defaults every list except `pageHeaders` to empty.
      if (list !== "pageHeaders") {
        prepared[list] = [];
      }
      continue;
    }
    const ordered = list === "htmlRoutes" ? [...routes].sort(compareSpecificity) : routes;
    prepared[list] = ordered.map((route) => ({...route, namedRegex: new RegExp(route.namedRegex)}));
  }
  return prepared;
};
