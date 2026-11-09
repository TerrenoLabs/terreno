#!/usr/bin/env bun
/**
 * Validates the manual regression suites so every case keeps a stable, unique ID and a
 * walkable Steps and Expected.
 *
 * Policy: docs/regression/README.md (format from the planning plugin's testing-plan
 * reference).
 */
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const COLUMNS = ["ID", "Case", "Steps", "Expected", "Platforms", "Automated by", "Added"];
const AREA_PATTERN = /^[A-Z][A-Z0-9]*$/;
const LAST_RUN_PATTERN = /^(never|\d{4}-\d{2}-\d{2} \([^,()]+, [0-9a-f]{7,40}\))$/;
const IP_ROW_PATTERN = /^E\d+$/;
const SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const INDEX_FILE = "README.md";

interface SuiteResult {
  area?: string;
  errors: string[];
  ids: string[];
}

interface HeaderLine {
  line: number;
  value: string;
}

// Splits a markdown table row on unescaped pipes, dropping the outer empty cells.
const splitRow = (text: string): string[] => {
  const trimmed = text
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
};

const findHeader = ({label, lines}: {label: string; lines: string[]}): HeaderLine | undefined => {
  const prefix = `${label}:`;
  const index = lines.findIndex((text) => text.startsWith(prefix));
  if (index === -1) {
    return undefined;
  }
  return {line: index + 1, value: lines[index].slice(prefix.length).trim()};
};

// Blanks fenced code blocks so an example table or header in prose is never validated,
// while keeping line numbers aligned with the file.
const blankFencedLines = (lines: string[]): string[] => {
  let isFenced = false;
  return lines.map((text) => {
    if (FENCE_PATTERN.test(text)) {
      isFenced = !isFenced;
      return "";
    }
    return isFenced ? "" : text;
  });
};

const validateHeaders = ({
  lines,
  path,
}: {
  lines: string[];
  path: string;
}): {area?: string; errors: string[]} => {
  const errors: string[] = [];
  const firstIndex = lines.findIndex((text) => text.trim() !== "");
  if (firstIndex === -1 || !/^# \S/.test(lines[firstIndex])) {
    errors.push(
      `${path}:${Math.max(firstIndex, 0) + 1}: first line must be a \`# <title>\` heading`
    );
  }

  const area = findHeader({label: "Area", lines});
  let validArea: string | undefined;
  if (!area) {
    errors.push(`${path}: missing \`Area: <PREFIX>\` line`);
  } else if (!AREA_PATTERN.test(area.value)) {
    errors.push(
      `${path}:${area.line}: Area must be an uppercase prefix such as AUTH, got \`${area.value}\``
    );
  } else {
    validArea = area.value;
  }

  const owner = findHeader({label: "Owner", lines});
  if (!owner) {
    errors.push(`${path}: missing \`Owner:\` line`);
  } else if (!owner.value) {
    errors.push(`${path}:${owner.line}: Owner is empty`);
  }

  const lastRun = findHeader({label: "Last full run", lines});
  if (!lastRun) {
    errors.push(`${path}: missing \`Last full run:\` line`);
  } else if (!LAST_RUN_PATTERN.test(lastRun.value)) {
    errors.push(
      `${path}:${lastRun.line}: Last full run must be \`never\` or \`YYYY-MM-DD (<who>, <short sha>)\``
    );
  }

  return {area: validArea, errors};
};

const validateRow = ({
  area,
  cells,
  line,
  path,
  seen,
}: {
  area?: string;
  cells: string[];
  line: number;
  path: string;
  seen: Map<string, number>;
}): string[] => {
  if (cells.length !== COLUMNS.length) {
    return [`${path}:${line}: row has ${cells.length} cells, expected ${COLUMNS.length}`];
  }

  const errors: string[] = [];
  const id = cells[0];
  if (id.includes("-new-")) {
    errors.push(
      `${path}:${line}: ${id} is a provisional IP ID; assign the next free ${area ?? "AREA"}-NNN`
    );
  } else if (area && !new RegExp(`^${area}-\\d{3}$`).test(id)) {
    errors.push(`${path}:${line}: ID ${id} must look like ${area}-NNN`);
  }

  const firstLine = seen.get(id);
  if (firstLine !== undefined) {
    errors.push(`${path}:${line}: duplicate ID ${id} (first used on line ${firstLine})`);
  } else {
    seen.set(id, line);
  }

  COLUMNS.forEach((column, index) => {
    if (index > 0 && !cells[index]) {
      errors.push(`${path}:${line}: ${id} has an empty ${column}`);
    }
  });

  const automatedBy = cells[COLUMNS.indexOf("Automated by")];
  if (IP_ROW_PATTERN.test(automatedBy)) {
    errors.push(
      `${path}:${line}: ${id} Automated by names IP row ${automatedBy}; use manual or a spec path`
    );
  } else if (automatedBy && automatedBy !== "manual" && !automatedBy.includes("/")) {
    errors.push(
      `${path}:${line}: ${id} Automated by must be manual or a spec path, got \`${automatedBy}\``
    );
  }

  return errors;
};

/** Validates one suite file's header lines and case table. */
export const validateSuite = ({content, path}: {content: string; path: string}): SuiteResult => {
  const lines = blankFencedLines(content.split(/\r?\n/));
  const tableStart = lines.findIndex((text) => text.trim().startsWith("|"));
  // Header lines count only above the table, where the suite format puts them.
  const headerLines = tableStart === -1 ? lines : lines.slice(0, tableStart);
  const {area, errors} = validateHeaders({lines: headerLines, path});

  if (tableStart === -1) {
    return {area, errors: [...errors, `${path}: missing the case table`], ids: []};
  }

  const header = splitRow(lines[tableStart]);
  if (header.join("|") !== COLUMNS.join("|")) {
    errors.push(`${path}:${tableStart + 1}: table columns must be ${COLUMNS.join(" | ")}`);
    return {area, errors, ids: []};
  }

  const separator = splitRow(lines[tableStart + 1] ?? "");
  const hasSeparator =
    separator.length === COLUMNS.length &&
    separator.every((cell) => SEPARATOR_CELL_PATTERN.test(cell));
  if (!hasSeparator) {
    errors.push(`${path}:${tableStart + 2}: the column row must be followed by a \`| --- |\` row`);
    return {area, errors, ids: []};
  }

  const seen = new Map<string, number>();
  let index = tableStart + 2;
  for (; index < lines.length && lines[index].trim().startsWith("|"); index++) {
    errors.push(...validateRow({area, cells: splitRow(lines[index]), line: index + 1, path, seen}));
  }

  const strayRow = lines.slice(index).findIndex((text) => text.trim().startsWith("|"));
  if (strayRow !== -1) {
    errors.push(`${path}:${index + strayRow + 1}: a suite holds exactly one case table`);
  }

  return {area, errors, ids: [...seen.keys()]};
};

/** Validates every suite in a directory and that no two suites declare the same area. */
export const validateSuiteDirectory = ({
  directory,
  displayRoot,
}: {
  directory: string;
  displayRoot: string;
}): string[] => {
  if (!existsSync(directory)) {
    return [`${displayRoot}: regression suite directory does not exist`];
  }

  const errors: string[] = [];
  const areaOwners = new Map<string, string>();
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== INDEX_FILE)
    .sort();

  for (const name of files) {
    const path = `${displayRoot}/${name}`;
    const result = validateSuite({content: readFileSync(join(directory, name), "utf8"), path});
    errors.push(...result.errors);
    if (!result.area) {
      continue;
    }
    const owner = areaOwners.get(result.area);
    if (owner) {
      errors.push(`${path}: Area ${result.area} is already declared by ${owner}`);
    } else {
      areaOwners.set(result.area, path);
    }
  }

  return errors;
};

const main = (): void => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const displayRoot = process.argv[2] ?? "docs/regression";
  const errors = validateSuiteDirectory({directory: join(repoRoot, displayRoot), displayRoot});

  if (errors.length > 0) {
    console.error(`check-regression-suites: found ${errors.length} problem(s):\n`);
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    console.error("\nSee docs/regression/README.md for the suite format.");
    process.exit(1);
  }

  console.info(`check-regression-suites: every suite in ${displayRoot} is well formed`);
};

if (import.meta.main) {
  main();
}
