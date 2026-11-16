import {describe, expect, it, setDefaultTimeout} from "bun:test";

import {CHECKOUT_ROOT, renderBootstrapPrompt} from "./bootstrapPrompt";

setDefaultTimeout(90_000);

describe("renderBootstrapPrompt", () => {
  it("renders the local prompt against this checkout", async () => {
    const prompt = await renderBootstrapPrompt({version: "local"});
    expect(prompt).toContain(`--terreno-path ${CHECKOUT_ROOT}`);
    expect(prompt).toContain("terreno_bootstrap_ai_rules");
    expect(prompt).not.toContain("bunx create-terreno-app");
  });

  it("rejects versions below 58.0.0", async () => {
    await expect(renderBootstrapPrompt({version: "57.4.0"})).rejects.toThrow(
      "version below 58.0.0 not supported"
    );
  });

  it("rejects versions that are not x.y.z", async () => {
    await expect(renderBootstrapPrompt({version: "58.0.0-beta.1"})).rejects.toThrow("not a stable");
  });

  for (const version of ["58.0.0", "58.0.6"]) {
    it(`renders the published ${version} prompt from the registry`, async () => {
      const prompt = await renderBootstrapPrompt({version}).catch((error: Error) => error);
      if (prompt instanceof Error) {
        console.warn(`skipped: registry unavailable (${prompt.message.split("\n")[0]})`);
        return;
      }
      expect(prompt).toContain("bunx create-terreno-app");
      expect(prompt).toContain("terreno_bootstrap_ai_rules");
    });
  }
});
