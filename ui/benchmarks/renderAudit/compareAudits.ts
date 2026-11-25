#!/usr/bin/env bun
/**
 * Compare two audit reports step by step.
 * Usage: bun compareAudits.ts before.json after.json
 * Exits 1 when a step wastes more renders than before, or the total render count rises.
 */
import {readFileSync} from "node:fs";

interface StepSummary {
  label: string;
  renders: number;
  wasted: number;
}

interface ReportSummary {
  steps: StepSummary[];
  totals: {renders: number; wasted: number};
}

const readReport = (path: string): ReportSummary => {
  return JSON.parse(readFileSync(path, "utf8")) as ReportSummary;
};

const delta = (before: number, after: number): string => {
  if (before === after) {
    return "0";
  }
  const percent = before === 0 ? "" : ` (${Math.round(((after - before) / before) * 100)}%)`;
  return `${after > before ? "+" : ""}${after - before}${percent}`;
};

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("Usage: bun compareAudits.ts before.json after.json");
  process.exit(2);
}

const before = readReport(beforePath);
const after = readReport(afterPath);
const lines: string[] = [
  "| Step | Renders before | after | Δ | Wasted before | after | Δ |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
];
let hasRegression = false;

for (const step of before.steps) {
  const match = after.steps.find((item) => item.label === step.label);
  if (!match) {
    lines.push(`| ${step.label} | ${step.renders} | missing | | ${step.wasted} | missing | |`);
    hasRegression = true;
    continue;
  }
  if (match.wasted > step.wasted) {
    hasRegression = true;
  }
  lines.push(
    `| ${step.label} | ${step.renders} | ${match.renders} | ${delta(step.renders, match.renders)} | ` +
      `${step.wasted} | ${match.wasted} | ${delta(step.wasted, match.wasted)} |`
  );
}
lines.push(
  `| **Total** | ${before.totals.renders} | ${after.totals.renders} | ` +
    `${delta(before.totals.renders, after.totals.renders)} | ${before.totals.wasted} | ` +
    `${after.totals.wasted} | ${delta(before.totals.wasted, after.totals.wasted)} |`
);

if (after.totals.renders > before.totals.renders) {
  hasRegression = true;
}

console.info(lines.join("\n"));
process.exit(hasRegression ? 1 : 0);
