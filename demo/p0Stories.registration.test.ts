import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const DEMO_CONFIG_PATH = join(import.meta.dir, "demoConfig.tsx");

const registeredConfigurationExports = (source: string): string[] => {
  const matches = [...source.matchAll(/^import \{([^}]+)\} from "@story-config\//gm)];
  const names: string[] = [];
  for (const match of matches) {
    const inner = match[1] ?? "";
    for (const part of inner.split(",")) {
      const name = part.trim();
      if (name.endsWith("Configuration")) {
        names.push(name);
      }
    }
  }
  return names;
};

describe("P0 demo story registration", () => {
  it("registers ListDetailLayout in demoConfig", () => {
    const source = readFileSync(DEMO_CONFIG_PATH, "utf8");
    expect(registeredConfigurationExports(source)).toContain("ListDetailLayoutConfiguration");
  });

  it("registers GPTChat, SocialLoginButton, and SplitPage in demoConfig", () => {
    const source = readFileSync(DEMO_CONFIG_PATH, "utf8");
    const registered = registeredConfigurationExports(source);
    expect(registered).toContain("GPTChatConfiguration");
    expect(registered).toContain("SocialLoginButtonConfiguration");
    expect(registered).toContain("SplitPageConfiguration");
  });
});
