import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {stageIds} from "./stages";

const skillDir = join(import.meta.dir, "..", "..", ".rulesync", "skills", "bootstrap-todo-loop");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const rubric = readFileSync(join(skillDir, "references", "rubric.md"), "utf8");

describe("bootstrap-todo-loop skill", () => {
  it("opens with the literal naive prompt", () => {
    expect(skill).toContain("make me a todo app");
  });

  it("names every stage id from the registry", () => {
    for (const id of stageIds()) {
      expect(skill).toContain(`\`${id}\``);
    }
  });

  it("asks no further questions and drives the loop command", () => {
    expect(skill).toContain("no further questions");
    expect(skill).toContain("bun run bootstrap-loop loop");
    expect(skill).toContain("bun run bootstrap-loop stage");
  });

  it("has frontmatter with name and description", () => {
    expect(skill).toMatch(/^---\nname: bootstrap-todo-loop\n/);
    expect(skill).toContain("description:");
  });

  it("rubric lists every row R1-R13", () => {
    for (let row = 1; row <= 13; row++) {
      expect(rubric).toContain(`R${row} `);
    }
  });
});
