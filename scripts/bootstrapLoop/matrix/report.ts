import {DateTime} from "luxon";

import {hasRegressions, type RunDiff, type RunSnapshot} from "./diff";

const FIXED_COLUMN = "Fixed at HEAD";

const table = (diff: RunDiff): string[] => {
  const rows: string[][] = [
    ...diff.rowRegressions.map((item) => ["Rubric row", item.row, item.reason]),
    ...diff.iterationRegressions.map((item) => [
      "Iterations",
      "-",
      `${String(item.previous)} → ${String(item.now)} scoring passes`,
    ]),
    ...diff.timeRegressions.map((item) => [
      "Time",
      item.scope,
      `${String(item.previous)} → ${String(item.now)} min`,
    ]),
    ...diff.removedFiles.map((file) => ["Removed file", file, "present in previous version"]),
  ];
  if (rows.length === 0) {
    return ["No regressions.", ""];
  }
  const escapeCell = (cell: string): string =>
    cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| Kind | Subject | Detail | ${FIXED_COLUMN} |`,
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |  |`),
    "",
  ];
};

/** REGRESSIONS.md: a summary, then one table per adjacent version pair. */
export const renderReport = (snapshots: RunSnapshot[], diffs: RunDiff[]): string => {
  const lines = [
    "# Bootstrap todo loop: version regressions",
    "",
    `Generated ${DateTime.now().toISODate() as string}. Versions run: ${snapshots.map((s) => s.version).join(", ") || "none"}.`,
    "",
    "## Per-version result",
    "",
    "| Version | Rubric | Iterations | Total minutes |",
    "| --- | --- | --- | --- |",
    ...snapshots.map((snapshot) => {
      const passed = snapshot.score.rows.filter((row) => row.status === "PASS").length;
      return `| ${snapshot.version} | ${String(passed)}/${String(snapshot.score.rows.length)}${snapshot.score.pass ? " (green)" : ""} | ${String(snapshot.iterations)} | ${String(snapshot.score.times.totalMinutes)} |`;
    }),
    "",
  ];
  for (const diff of diffs) {
    lines.push(
      `## ${diff.from} → ${diff.to}${hasRegressions(diff) ? "" : " (clean)"}`,
      "",
      ...table(diff)
    );
  }
  return lines.join("\n");
};
