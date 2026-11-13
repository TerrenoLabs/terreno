import {afterEach, describe, expect, it} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {validateSuite, validateSuiteDirectory} from "./checkSuites";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const HEADER = "| ID | Case | Steps | Expected | Platforms | Automated by | Added |";
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |";

const row = ({
  automatedBy = "manual",
  caseName = "Reset email arrives",
  expected = "The inbox shows one reset email",
  id = "AUTH-001",
  steps = "Signed out on web, request a reset for a seeded user",
}: {
  automatedBy?: string;
  caseName?: string;
  expected?: string;
  id?: string;
  steps?: string;
}): string =>
  `| ${id} | ${caseName} | ${steps} | ${expected} | Web | ${automatedBy} | e2e-and-regression-testing |`;

const suite = ({
  area = "AUTH",
  header = HEADER,
  lastRun = "Last full run: never",
  owner = "Owner: platform",
  rows = [row({})],
  title = "# Auth regression suite",
}: {
  area?: string;
  header?: string;
  lastRun?: string;
  owner?: string;
  rows?: string[];
  title?: string;
}): string =>
  [title, "", `Area: ${area}`, owner, lastRun, "", header, SEPARATOR, ...rows, ""].join("\n");

const check = (content: string): string[] => validateSuite({content, path: "auth.md"}).errors;

describe("validateSuite", () => {
  it("accepts a well-formed suite and reports its area and IDs", () => {
    const result = validateSuite({
      content: suite({rows: [row({}), row({id: "AUTH-002"})]}),
      path: "auth.md",
    });
    expect(result.errors).toEqual([]);
    expect(result.area).toBe("AUTH");
    expect(result.ids).toEqual(["AUTH-001", "AUTH-002"]);
  });

  it("accepts a recorded full run with who and short sha", () => {
    expect(check(suite({lastRun: "Last full run: 2026-10-24 (Josh, 63580f52)"}))).toEqual([]);
  });

  it("rejects a duplicate ID", () => {
    expect(check(suite({rows: [row({}), row({})]}))).toEqual([
      "auth.md:10: duplicate ID AUTH-001 (first used on line 9)",
    ]);
  });

  it("rejects an empty Expected", () => {
    expect(check(suite({rows: [row({expected: ""})]}))).toEqual([
      "auth.md:9: AUTH-001 has an empty Expected",
    ]);
  });

  it("rejects an empty Steps", () => {
    expect(check(suite({rows: [row({steps: "  "})]}))).toEqual([
      "auth.md:9: AUTH-001 has an empty Steps",
    ]);
  });

  it("rejects a provisional -new- ID", () => {
    expect(check(suite({rows: [row({id: "AUTH-new-1"})]}))).toEqual([
      "auth.md:9: AUTH-new-1 is a provisional IP ID; assign the next free AUTH-NNN",
    ]);
  });

  it("rejects an ID that does not use the file's area or three digits", () => {
    expect(check(suite({rows: [row({id: "SYNC-001"}), row({id: "AUTH-1"})]}))).toEqual([
      "auth.md:9: ID SYNC-001 must look like AUTH-NNN",
      "auth.md:10: ID AUTH-1 must look like AUTH-NNN",
    ]);
  });

  it("rejects an IP-local E<n> reference in Automated by", () => {
    expect(check(suite({rows: [row({automatedBy: "E3"})]}))).toEqual([
      "auth.md:9: AUTH-001 Automated by names IP row E3; use manual or a spec path",
    ]);
  });

  it("keeps an escaped pipe inside one cell", () => {
    expect(check(suite({rows: [row({steps: "Pick Email \\| Phone, then submit"})]}))).toEqual([]);
  });

  it("rejects a row with the wrong number of cells", () => {
    expect(check(suite({rows: ["| AUTH-001 | Case | Steps | Expected |"]}))).toEqual([
      "auth.md:9: row has 4 cells, expected 7",
    ]);
  });

  it("rejects a missing title, area, owner, and last-run line", () => {
    const content = [HEADER, SEPARATOR, row({}), ""].join("\n");
    expect(check(content)).toEqual([
      "auth.md:1: first line must be a `# <title>` heading",
      "auth.md: missing `Area: <PREFIX>` line",
      "auth.md: missing `Owner:` line",
      "auth.md: missing `Last full run:` line",
    ]);
  });

  it("rejects a malformed area, empty owner, and malformed last-run line", () => {
    expect(
      check(suite({area: "auth", lastRun: "Last full run: yesterday", owner: "Owner:"}))
    ).toEqual([
      "auth.md:3: Area must be an uppercase prefix such as AUTH, got `auth`",
      "auth.md:4: Owner is empty",
      "auth.md:5: Last full run must be `never` or `YYYY-MM-DD (<who>, <short sha>)`",
    ]);
  });

  it("rejects a table whose columns differ from the suite format", () => {
    const header = "| ID | Case | Steps | Expected | Platforms | Added |";
    expect(check(suite({header}))).toEqual([
      "auth.md:7: table columns must be ID | Case | Steps | Expected | Platforms | Automated by | Added",
    ]);
  });

  it("rejects a table with no separator row instead of skipping its first case", () => {
    const content = suite({rows: [row({expected: ""})]}).replace(`${SEPARATOR}\n`, "");
    expect(check(content)).toEqual([
      "auth.md:8: the column row must be followed by a `| --- |` row",
    ]);
  });

  it("rejects a second table after the case table", () => {
    const rows = [row({}), "", "Notes", HEADER, SEPARATOR, row({id: "AUTH-002"})];
    expect(check(suite({rows}))).toEqual(["auth.md:12: a suite holds exactly one case table"]);
  });

  it("only reads header lines above the table", () => {
    const content = ["# Auth regression suite", "", HEADER, SEPARATOR, row({}), ""]
      .concat(["Area: AUTH", "Owner: platform", "Last full run: never"])
      .join("\n");
    expect(check(content)).toEqual([
      "auth.md: missing `Area: <PREFIX>` line",
      "auth.md: missing `Owner:` line",
      "auth.md: missing `Last full run:` line",
    ]);
  });

  it("ignores an example table inside a code fence", () => {
    const example = ["```markdown", HEADER, SEPARATOR, row({id: "AUTH-new-1"}), "```", ""];
    const content = suite({}).replace(HEADER, `${example.join("\n")}\n${HEADER}`);
    expect(check(content)).toEqual([]);
  });

  it("accepts CRLF line endings", () => {
    expect(check(suite({rows: [row({}), row({id: "AUTH-002"})]}).replaceAll("\n", "\r\n"))).toEqual(
      []
    );
  });

  it("reports line 1 for an empty file", () => {
    expect(check("")[0]).toBe("auth.md:1: first line must be a `# <title>` heading");
  });

  it("accepts a spec path in Automated by and rejects free text", () => {
    expect(check(suite({rows: [row({automatedBy: "example-frontend/e2e/auth.spec.ts"})]}))).toEqual(
      []
    );
    expect(check(suite({rows: [row({automatedBy: "Validator (phrases only)"})]}))).toEqual([
      "auth.md:9: AUTH-001 Automated by must be manual or a spec path, got `Validator (phrases only)`",
    ]);
  });

  it("rejects a file with no case table", () => {
    const content = [
      "# Auth regression suite",
      "",
      "Area: AUTH",
      "Owner: x",
      "Last full run: never",
    ];
    expect(check(content.join("\n"))).toEqual(["auth.md: missing the case table"]);
  });
});

describe("validateSuiteDirectory", () => {
  let directory = "";

  afterEach(() => {
    if (directory) {
      rmSync(directory, {force: true, recursive: true});
      directory = "";
    }
  });

  const writeSuites = (files: Record<string, string>): string => {
    directory = mkdtempSync(join(tmpdir(), "regression-suites-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(directory, name), content);
    }
    return directory;
  };

  it("skips the README and accepts distinct areas", () => {
    const root = writeSuites({
      "auth.md": suite({}),
      "README.md": "# Regression suites\n\nNo table here.\n",
      "syncdb.md": suite({area: "SYNC", rows: [row({id: "SYNC-001"})]}),
    });
    expect(validateSuiteDirectory({directory: root, displayRoot: "docs/regression"})).toEqual([]);
  });

  it("rejects two files that declare the same area", () => {
    const root = writeSuites({"auth.md": suite({}), "login.md": suite({})});
    expect(validateSuiteDirectory({directory: root, displayRoot: "docs/regression"})).toEqual([
      "docs/regression/login.md: Area AUTH is already declared by docs/regression/auth.md",
    ]);
  });

  it("reports errors with the display path", () => {
    const root = writeSuites({"auth.md": suite({rows: [row({}), row({})]})});
    expect(validateSuiteDirectory({directory: root, displayRoot: "docs/regression"})).toEqual([
      "docs/regression/auth.md:10: duplicate ID AUTH-001 (first used on line 9)",
    ]);
  });

  it("rejects a missing directory", () => {
    expect(
      validateSuiteDirectory({
        directory: join(tmpdir(), "no-such-regression-dir"),
        displayRoot: "x",
      })
    ).toEqual(["x: regression suite directory does not exist"]);
  });

  it("passes on the repository's committed suites", () => {
    expect(
      validateSuiteDirectory({
        directory: join(REPO_ROOT, "docs", "regression"),
        displayRoot: "docs/regression",
      })
    ).toEqual([]);
  });
});
