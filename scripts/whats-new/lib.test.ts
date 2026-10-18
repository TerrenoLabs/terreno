import {describe, it} from "bun:test";
import {assert} from "chai";

import {parseWhatsNewEntries, renderWhatsNewFile} from "./lib";

const CHANGELOG = `# Changelog

## [Unreleased]

Unreleased changes live in [\`changelog/unreleased/\`](changelog/unreleased/).

## [3.0.0] - 2026-10-13

Upgrade note: [\`3.0.0.md\`](mcp-server/src/docs/upgrades/3.0.0.md).

### Fixed

- Primary buttons are white again. (#1567)

## [2.0.0] - 2026-10-12

### Added

- See [the docs](https://example.com/docs) and [how-to](docs/how-to/x.md#part).

## [1.0.0]

### Added

- First release.

[3.0.0]: https://github.com/TerrenoLabs/terreno/releases/tag/3.0.0
[2.0.0]: https://github.com/TerrenoLabs/terreno/releases/tag/2.0.0
`;

describe("parseWhatsNewEntries", () => {
  it("returns released sections newest first without Unreleased", (): void => {
    const entries = parseWhatsNewEntries({changelog: CHANGELOG});
    assert.deepEqual(
      entries.map((entry) => [entry.version, entry.date]),
      [
        ["3.0.0", "2026-10-13"],
        ["2.0.0", "2026-10-12"],
        ["1.0.0", undefined],
      ]
    );
    assert.notProperty(entries[2], "date");
  });

  it("points repo-relative links and pull request numbers at GitHub", (): void => {
    const [latest, previous] = parseWhatsNewEntries({changelog: CHANGELOG});
    assert.include(
      latest?.body,
      "](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/src/docs/upgrades/3.0.0.md)"
    );
    assert.include(latest?.body, "([#1567](https://github.com/TerrenoLabs/terreno/pull/1567))");
    assert.include(previous?.body, "[the docs](https://example.com/docs)");
    assert.include(
      previous?.body,
      "[how-to](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/x.md#part)"
    );
  });

  it("drops trailing link reference definitions", (): void => {
    const entries = parseWhatsNewEntries({changelog: CHANGELOG});
    assert.equal(entries[2]?.body, "### Added\n\n- First release.");
  });

  it("keeps only the most recent releases", (): void => {
    const entries = parseWhatsNewEntries({changelog: CHANGELOG, limit: 2});
    assert.deepEqual(
      entries.map((entry) => entry.version),
      ["3.0.0", "2.0.0"]
    );
  });
});

describe("parseWhatsNewEntries line wrapping", () => {
  it("joins hard-wrapped list lines but keeps nested items", (): void => {
    const [entry] = parseWhatsNewEntries({
      changelog: "## [1.0.0] - 2026-10-01\n\n- First line\n  continues here.\n  - Nested item\n",
    });
    assert.equal(entry?.body, "- First line continues here.\n  - Nested item");
  });
});

describe("renderWhatsNewFile", () => {
  it("renders stable JSON with a trailing newline", (): void => {
    const file = renderWhatsNewFile([{body: "- Fix", version: "1.0.0"}]);
    assert.equal(file, '[\n  {\n    "body": "- Fix",\n    "version": "1.0.0"\n  }\n]\n');
  });
});
