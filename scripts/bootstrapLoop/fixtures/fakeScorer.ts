#!/usr/bin/env bun
/**
 * Stand-in for the scorer session. Records its cwd, env and prompt, then answers per
 * BOOTSTRAP_LOOP_FAKE_SCORER_MODE:
 *   agree    every row PASS, visualScore 4 (default)
 *   failR3   R3 FAIL with a reason, visualScore 2
 *   garbage  prints text that is not JSON
 */
import {writeFileSync} from "node:fs";

const prompt = await Bun.stdin.text();
const record = process.env.BOOTSTRAP_LOOP_FAKE_SCORER_RECORD;
if (record) {
  writeFileSync(record, JSON.stringify({cwd: process.cwd(), env: process.env, prompt}));
}
const mode = process.env.BOOTSTRAP_LOOP_FAKE_SCORER_MODE ?? "agree";
if (mode === "garbage") {
  console.info("I think it looks fine");
  process.exit(0);
}
const rows = Array.from({length: 13}, (_, index) => ({
  reason: "agrees with probe",
  row: `R${String(index + 1)}`,
  status: "PASS",
}));
if (mode === "failR3") {
  rows[2] = {reason: "login screen is unstyled", row: "R3", status: "FAIL"};
}
console.info(JSON.stringify({rows, visualScore: mode === "failR3" ? 2 : 4}));
