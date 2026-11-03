import {afterEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  listUncoveredScreens,
  resolveUserGuide,
  validateGuideDirectory,
  validatePage,
} from "./checkUserGuide";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const page = ({
  area = "todos",
  audience = "user",
  extraSection = "",
  heading = "Set a due date on a todo",
  platforms = "[web, ios]",
  questions = ["How do I set a due date?"],
  steps = "1. On **Todos**, tap a todo.\n2. Tap **Save**.",
  title = "Set a due date on a todo",
}: {
  area?: string;
  audience?: string;
  extraSection?: string;
  heading?: string;
  platforms?: string;
  questions?: string[];
  steps?: string;
  title?: string;
}): string =>
  [
    "---",
    `title: ${title}`,
    `area: ${area}`,
    `audience: ${audience}`,
    `platforms: ${platforms}`,
    "questions:",
    ...questions.map((question) => `  - ${question}`),
    "added: todos-due-date",
    "---",
    "",
    `# ${heading}`,
    "",
    "## What it does",
    "",
    "A due date shows when a todo should be done.",
    "",
    "## How to use it",
    "",
    steps,
    "",
    "## Intended use",
    "",
    "Use due dates for todos that must happen by a certain day.",
    extraSection,
  ].join("\n");

const check = (content: string): string[] =>
  validatePage({area: "todos", content, path: "guide/todos/due-dates.md", repoRoot: REPO_ROOT})
    .errors;

const INDEX = [
  "# User guide",
  "",
  "| Area | Page | Audience | Title |",
  "| --- | --- | --- | --- |",
  "| todos | [due-dates.md](todos/due-dates.md) | user | Set a due date on a todo |",
].join("\n");

let directories: string[] = [];

const makeDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "user-guide-"));
  directories.push(directory);
  return directory;
};

const writeGuide = ({index = INDEX, pages = {"todos/due-dates.md": page({})}}): string => {
  const directory = makeDirectory();
  for (const [path, content] of Object.entries(pages)) {
    mkdirSync(join(directory, path, ".."), {recursive: true});
    writeFileSync(join(directory, path), content);
  }
  writeFileSync(join(directory, "README.md"), index);
  return directory;
};

afterEach((): void => {
  for (const directory of directories) {
    rmSync(directory, {force: true, recursive: true});
  }
  directories = [];
});

describe("validatePage", (): void => {
  it("accepts a page in the contract format", (): void => {
    expect(check(page({}))).toEqual([]);
  });

  it("accepts an optional Related section", (): void => {
    expect(check(page({extraSection: "\n## Related\n\n- [Todos](todos.md)\n"}))).toEqual([]);
  });

  it("rejects a page without frontmatter", (): void => {
    expect(check("# Title\n")).toEqual(["guide/todos/due-dates.md: missing `---` frontmatter"]);
  });

  it("rejects an unknown audience, platform, and an area that does not match its directory", (): void => {
    expect(check(page({area: "lists", audience: "everyone", platforms: "[web, desktop]"}))).toEqual(
      [
        "guide/todos/due-dates.md: `area: lists` must match its directory `todos`",
        "guide/todos/due-dates.md: `audience` must be one of user, admin, staff",
        "guide/todos/due-dates.md: unknown platform `desktop`",
      ]
    );
  });

  it("rejects missing, too many, or non-question questions", (): void => {
    expect(check(page({questions: []}))).toContain(
      "guide/todos/due-dates.md: `questions` must list 1 to 5 questions"
    );
    expect(check(page({questions: ["a?", "b?", "c?", "d?", "e?", "f?"]}))).toContain(
      "guide/todos/due-dates.md: `questions` must list 1 to 5 questions"
    );
    expect(check(page({questions: ["Due dates"]}))).toEqual([
      "guide/todos/due-dates.md: question must end with `?`: Due dates",
    ]);
  });

  it("rejects a heading that does not match the title", (): void => {
    expect(check(page({heading: "Due dates"}))).toEqual([
      "guide/todos/due-dates.md: the `#` heading must match `title`",
    ]);
  });

  it("rejects missing numbered steps", (): void => {
    expect(check(page({steps: "Tap a todo and save it."}))).toEqual([
      "guide/todos/due-dates.md: `## How to use it` needs numbered steps",
    ]);
  });

  it("rejects missing, reordered, or extra sections", (): void => {
    const reordered = page({}).replace("## What it does", "## Overview");
    expect(check(reordered)).toEqual([
      "guide/todos/due-dates.md: sections must be ## What it does, ## How to use it, ## Intended use, once each, in that order",
      "guide/todos/due-dates.md: unexpected section `## Overview`",
    ]);
  });

  it("rejects roadmap text and developer details", (): void => {
    expect(
      check(page({steps: "1. Open http://localhost:8082. Reminders are coming soon."}))
    ).toEqual([
      "guide/todos/due-dates.md: page text must not contain /coming soon/i",
      "guide/todos/due-dates.md: page text must not contain /localhost/i",
    ]);
  });

  it("rejects a screen path that does not exist", (): void => {
    const content = page({}).replace(
      "added: todos-due-date",
      "screens: [example-frontend/app/missing.tsx]\nadded: todos-due-date"
    );
    expect(check(content)).toEqual([
      "guide/todos/due-dates.md: screen `example-frontend/app/missing.tsx` does not exist",
    ]);
  });
});

describe("validateGuideDirectory", (): void => {
  it("accepts a guide whose index lists every page", (): void => {
    const directory = writeGuide({});
    expect(validateGuideDirectory({directory, displayRoot: "guide", repoRoot: REPO_ROOT})).toEqual({
      errors: [],
      screens: [],
    });
  });

  it("rejects a page missing from the index and an index row with no page", (): void => {
    const directory = writeGuide({
      index: INDEX.replace("todos/due-dates.md)", "todos/gone.md)"),
    });
    expect(
      validateGuideDirectory({directory, displayRoot: "guide", repoRoot: REPO_ROOT}).errors
    ).toEqual([
      "guide/README.md:5: todos/gone.md is not a guide page",
      "guide/README.md: todos/due-dates.md is missing from the index",
    ]);
  });

  it("rejects an index row whose title or audience drifted", (): void => {
    const directory = writeGuide({index: INDEX.replace("| user |", "| admin |")});
    expect(
      validateGuideDirectory({directory, displayRoot: "guide", repoRoot: REPO_ROOT}).errors
    ).toEqual([
      "guide/README.md:5: row for todos/due-dates.md must match its area, audience, and title",
    ]);
  });

  it("rejects a missing index and non-kebab names", (): void => {
    const directory = writeGuide({pages: {"Todos/Due_Dates.md": page({area: "Todos"})}});
    rmSync(join(directory, "README.md"));
    expect(
      validateGuideDirectory({directory, displayRoot: "guide", repoRoot: REPO_ROOT}).errors
    ).toEqual([
      "guide/Todos/Due_Dates.md: area and page names must be kebab-case",
      "guide/README.md: missing the guide index",
    ]);
  });

  it("rejects a missing guide directory", (): void => {
    expect(
      validateGuideDirectory({
        directory: join(makeDirectory(), "absent"),
        displayRoot: "guide",
        repoRoot: REPO_ROOT,
      }).errors
    ).toEqual(["guide: user guide directory does not exist"]);
  });
});

describe("resolveUserGuide", (): void => {
  const withInstructions = (content: string): string => {
    const directory = makeDirectory();
    writeFileSync(join(directory, "AGENTS.md"), content);
    return directory;
  };

  it("defaults to docs/user-guide without a conventions table", (): void => {
    expect(resolveUserGuide({repoRoot: makeDirectory()})).toEqual({
      isOff: false,
      path: "docs/user-guide",
    });
  });

  it("reads an override path", (): void => {
    const repoRoot = withInstructions(
      "## User guide conventions\n\n| Key | Value |\n| --- | --- |\n| User guide | docs/help/ |\n"
    );
    expect(resolveUserGuide({repoRoot})).toEqual({isOff: false, path: "docs/help"});
  });

  it("turns the guide off for none with a reason", (): void => {
    const repoRoot = withInstructions(
      "## User guide conventions\n\n| Key | Value |\n| --- | --- |\n| User guide | none — CLI only |\n"
    );
    expect(resolveUserGuide({repoRoot})).toEqual({isOff: true, path: ""});
  });

  it("ignores a User guide row under another heading", (): void => {
    const repoRoot = withInstructions(
      "## Other\n\n| User guide | none |\n\n## User guide conventions\n\nNo table.\n"
    );
    expect(resolveUserGuide({repoRoot})).toEqual({isOff: false, path: "docs/user-guide"});
  });
});

describe("listUncoveredScreens", (): void => {
  it("lists routed screens no page names, skipping layouts, tests, and components", (): void => {
    const repoRoot = makeDirectory();
    const app = join(repoRoot, "app");
    mkdirSync(join(app, "(tabs)"), {recursive: true});
    for (const name of [
      "_layout.tsx",
      "+html.tsx",
      "login.tsx",
      "(tabs)/index.tsx",
      "(tabs)/index.test.tsx",
      "(tabs)/Widget.tsx",
    ]) {
      writeFileSync(join(app, name), "");
    }
    expect(
      listUncoveredScreens({appDirectory: app, coveredScreens: ["app/login.tsx"], repoRoot})
    ).toEqual(["app/(tabs)/index.tsx"]);
  });
});

describe("the repository's user guide", (): void => {
  it("is well formed", (): void => {
    const guide = resolveUserGuide({repoRoot: REPO_ROOT});
    if (guide.isOff) {
      return;
    }
    expect(
      validateGuideDirectory({
        directory: join(REPO_ROOT, guide.path),
        displayRoot: guide.path,
        repoRoot: REPO_ROOT,
      }).errors
    ).toEqual([]);
  });
});
