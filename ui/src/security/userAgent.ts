/** The kind of device a session's user agent came from. */
export type UserAgentDeviceType = "desktop" | "mobile" | "tablet" | "unknown";

/** What a session row shows about the device behind a user agent. */
export interface ParsedUserAgent {
  /** Browser name ("Chrome", "Safari", ...), or "App" for a native app's HTTP client. */
  browser?: string;
  /** Operating system name ("macOS", "iOS", "Android", ...). */
  os?: string;
  /** Desktop, mobile, tablet, or unknown when the user agent says nothing recognizable. */
  deviceType: UserAgentDeviceType;
}

/** Browser patterns, most specific first: Edge and Opera also send "Chrome", Chrome sends "Safari". */
const BROWSER_PATTERNS: {name: string; pattern: RegExp}[] = [
  {name: "Edge", pattern: /\bEdg(e|A|iOS)?\//},
  {name: "Opera", pattern: /\b(OPR|Opera)\//},
  {name: "Samsung Internet", pattern: /\bSamsungBrowser\//},
  {name: "Firefox", pattern: /\b(Firefox|FxiOS)\//},
  {name: "Chrome", pattern: /\b(Chrome|CriOS)\//},
  {name: "Safari", pattern: /\bVersion\/[\d.]+.*\bSafari\//},
];

/** OS patterns, most specific first: iOS user agents say "like Mac OS X", ChromeOS says "X11". */
const OS_PATTERNS: {name: string; pattern: RegExp}[] = [
  {name: "iPadOS", pattern: /\biPad\b/},
  {name: "iOS", pattern: /\b(iPhone|iPod)\b/},
  {name: "Android", pattern: /\bAndroid\b/},
  {name: "Windows", pattern: /\bWindows\b/},
  {name: "ChromeOS", pattern: /\bCrOS\b/},
  {name: "macOS", pattern: /\b(Macintosh|Mac OS X)\b/},
  {name: "Linux", pattern: /\bLinux\b/},
];

/** HTTP clients native apps send instead of a browser user agent. */
const NATIVE_APP_PATTERNS: {os: string; pattern: RegExp}[] = [
  {os: "iOS", pattern: /\bCFNetwork\/.*\bDarwin\//},
  {os: "Android", pattern: /^okhttp\//},
];

const findName = (
  userAgent: string,
  patterns: {name: string; pattern: RegExp}[]
): string | undefined => {
  return patterns.find(({pattern}) => pattern.test(userAgent))?.name;
};

const getDeviceType = ({userAgent, os}: {userAgent: string; os?: string}): UserAgentDeviceType => {
  if (os === "iPadOS") {
    return "tablet";
  }
  if (os === "iOS") {
    return "mobile";
  }
  if (os === "Android") {
    // Android phones send "Mobile"; Android tablets leave it out.
    return /\bMobile\b/.test(userAgent) ? "mobile" : "tablet";
  }
  if (os) {
    return "desktop";
  }
  return "unknown";
};

/**
 * Reads the browser, operating system and device type from a session's user agent. Covers the
 * common browsers and the HTTP clients React Native apps send (`CFNetwork`/`Darwin` on iOS,
 * `okhttp` on Android). Parts it can't recognize are left out.
 *
 * User agent sniffing has limits: iPadOS Safari requests desktop sites by default and reports
 * `Macintosh`, so it reads as Safari on macOS (desktop); and macOS native apps also send
 * `CFNetwork`/`Darwin`, so they read as an iOS app.
 */
export const parseUserAgent = (userAgent?: string | null): ParsedUserAgent => {
  if (!userAgent) {
    return {deviceType: "unknown"};
  }
  const nativeApp = NATIVE_APP_PATTERNS.find(({pattern}) => pattern.test(userAgent));
  if (nativeApp) {
    return {browser: "App", deviceType: "mobile", os: nativeApp.os};
  }
  const browser = findName(userAgent, BROWSER_PATTERNS);
  const os = findName(userAgent, OS_PATTERNS);
  return {
    deviceType: getDeviceType({os, userAgent}),
    ...(browser ? {browser} : {}),
    ...(os ? {os} : {}),
  };
};

/** Names a parsed user agent: "Chrome on macOS", or whichever part is known, or "Unknown device". */
export const getUserAgentLabel = ({browser, os}: ParsedUserAgent): string => {
  if (browser && os) {
    return `${browser} on ${os}`;
  }
  return browser ?? os ?? "Unknown device";
};

/** "Chrome on macOS", or whichever part is known, or "Unknown device". */
export const describeUserAgent = (userAgent?: string | null): string => {
  return getUserAgentLabel(parseUserAgent(userAgent));
};
