import {describe, expect, it} from "bun:test";

import {describeUserAgent, parseUserAgent} from "./userAgent";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1";
const FIREFOX_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.65";
const OPERA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
const CHROME_ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Mobile Safari/537.36";
const CHROME_ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Safari/537.36";
const SAMSUNG_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";
const CHROME_OS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const IOS_APP = "Example/1 CFNetwork/1496.0.7 Darwin/23.5.0";
const ANDROID_APP = "okhttp/4.12.0";

describe("parseUserAgent", () => {
  it("reads the browser, OS and device type of common desktop browsers", () => {
    expect(parseUserAgent(CHROME_MAC)).toEqual({
      browser: "Chrome",
      deviceType: "desktop",
      os: "macOS",
    });
    expect(parseUserAgent(SAFARI_MAC)).toEqual({
      browser: "Safari",
      deviceType: "desktop",
      os: "macOS",
    });
    expect(parseUserAgent(EDGE_WINDOWS)).toEqual({
      browser: "Edge",
      deviceType: "desktop",
      os: "Windows",
    });
    expect(parseUserAgent(OPERA_WINDOWS).browser).toBe("Opera");
    expect(parseUserAgent(FIREFOX_LINUX)).toEqual({
      browser: "Firefox",
      deviceType: "desktop",
      os: "Linux",
    });
    expect(parseUserAgent(CHROME_OS)).toEqual({
      browser: "Chrome",
      deviceType: "desktop",
      os: "ChromeOS",
    });
  });

  it("reads phones and tablets", () => {
    expect(parseUserAgent(SAFARI_IPHONE)).toEqual({
      browser: "Safari",
      deviceType: "mobile",
      os: "iOS",
    });
    expect(parseUserAgent(CHROME_IPHONE)).toEqual({
      browser: "Chrome",
      deviceType: "mobile",
      os: "iOS",
    });
    expect(parseUserAgent(FIREFOX_IPAD)).toEqual({
      browser: "Firefox",
      deviceType: "tablet",
      os: "iPadOS",
    });
    expect(parseUserAgent(CHROME_ANDROID_PHONE)).toEqual({
      browser: "Chrome",
      deviceType: "mobile",
      os: "Android",
    });
    expect(parseUserAgent(CHROME_ANDROID_TABLET)).toEqual({
      browser: "Chrome",
      deviceType: "tablet",
      os: "Android",
    });
    expect(parseUserAgent(SAMSUNG_ANDROID).browser).toBe("Samsung Internet");
  });

  it("recognizes native app requests", () => {
    expect(parseUserAgent(IOS_APP)).toEqual({browser: "App", deviceType: "mobile", os: "iOS"});
    expect(parseUserAgent(ANDROID_APP)).toEqual({
      browser: "App",
      deviceType: "mobile",
      os: "Android",
    });
  });

  it("returns unknown for missing or unrecognized user agents", () => {
    expect(parseUserAgent(undefined)).toEqual({deviceType: "unknown"});
    expect(parseUserAgent(null)).toEqual({deviceType: "unknown"});
    expect(parseUserAgent("")).toEqual({deviceType: "unknown"});
    expect(parseUserAgent("curl/8.7.1")).toEqual({deviceType: "unknown"});
  });
});

describe("describeUserAgent", () => {
  it("names the browser and OS", () => {
    expect(describeUserAgent(CHROME_MAC)).toBe("Chrome on macOS");
    expect(describeUserAgent(IOS_APP)).toBe("App on iOS");
  });

  it("falls back to whichever part is known, then to Unknown device", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Gecko")).toBe("Windows");
    expect(describeUserAgent("Mozilla/5.0 (compatible) Firefox/131.0")).toBe("Firefox");
    expect(describeUserAgent(undefined)).toBe("Unknown device");
  });
});
