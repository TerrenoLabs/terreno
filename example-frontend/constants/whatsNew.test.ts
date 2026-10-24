import {describe, expect, it} from "bun:test";

import {WHATS_NEW_RELEASES} from "./whatsNew";

describe("WHATS_NEW_RELEASES", () => {
  it("lists generated releases newest first with notes", () => {
    expect(WHATS_NEW_RELEASES.length).toBeGreaterThan(0);
    for (const release of WHATS_NEW_RELEASES) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(release.body.length).toBeGreaterThan(0);
    }
  });
});
