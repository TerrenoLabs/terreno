import {describe, it} from "bun:test";
import {assert} from "chai";
import {buildLabelCommand, findDuplicateNames, parseLabelsYaml} from "./sync-labels.ts";

describe("parseLabelsYaml", () => {
  it("parses name, color, and description", () => {
    const labels = parseLabelsYaml(`
- name: area:api
  color: "1D76DB"
  description: "@terreno/api and friends"
`);

    assert.lengthOf(labels, 1);
    assert.equal(labels[0]?.name, "area:api");
    assert.equal(labels[0]?.color, "1D76DB");
    assert.equal(labels[0]?.description, "@terreno/api and friends");
  });

  it("rejects a description carrying a stray quote", () => {
    assert.throws(
      () =>
        parseLabelsYaml(`
- name: area:auth
  color: "5319E7"
  description: Authentication, sessions, JWT"
`),
      /stray quote/
    );
  });

  it("rejects a color that is not six-digit hex", () => {
    assert.throws(
      () =>
        parseLabelsYaml(`
- name: area:api
  color: "#1D76DB"
  description: "Valid text"
`),
      /six-digit hex/
    );
  });

  it("rejects a missing description", () => {
    assert.throws(
      () =>
        parseLabelsYaml(`
- name: area:api
  color: "1D76DB"
`),
      /missing a description/
    );
  });

  it("parses the checked-in taxonomy with every description intact", async () => {
    const labels = parseLabelsYaml(await Bun.file(".github/labels.yml").text());

    assert.isAbove(labels.length, 0);
    assert.isEmpty(findDuplicateNames(labels));
    for (const label of labels) {
      assert.isNotEmpty(label.description, `${label.name} has an empty description`);
    }
  });
});

describe("findDuplicateNames", () => {
  it("reports names that appear more than once", () => {
    const duplicates = findDuplicateNames([
      {color: "1D76DB", description: "a", name: "area:api"},
      {color: "1D76DB", description: "b", name: "area:api"},
      {color: "2EA44F", description: "c", name: "area:ui"},
    ]);

    assert.deepEqual(duplicates, ["area:api"]);
  });
});

describe("buildLabelCommand", () => {
  it("passes the description as a single argv entry rather than shell text", () => {
    const command = buildLabelCommand({
      label: {color: "1D76DB", description: "Auth, sessions, JWT", name: "area:auth"},
      repo: "TerrenoLabs/terreno",
    });

    assert.include(command, "Auth, sessions, JWT");
    assert.include(command, "--force");
    assert.equal(command[0], "gh");
  });
});
