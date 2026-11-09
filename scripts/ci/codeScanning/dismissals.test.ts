import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";

import {type DismissalEntry, type LiveAlert, planDismissals, validateLedger} from "./dismissals";

const entry = (overrides: Partial<DismissalEntry> = {}): DismissalEntry => ({
  alert: 1,
  comment: "Covered by the app-level limiter",
  path: "api/src/auth.ts",
  reason: "false positive",
  rule: "js/missing-rate-limiting",
  ...overrides,
});

const alert = (overrides: Partial<LiveAlert> & {path?: string} = {}): LiveAlert => ({
  most_recent_instance: {location: {path: overrides.path ?? "api/src/auth.ts"}},
  number: overrides.number ?? 1,
  rule: overrides.rule ?? {id: "js/missing-rate-limiting"},
  state: overrides.state ?? "open",
});

describe("validateLedger", () => {
  it("accepts a well-formed ledger", () => {
    expect(validateLedger({dismissals: [entry()]}).errors).toEqual([]);
  });

  it("rejects a non-object and a missing array", () => {
    expect(validateLedger(null).errors).toEqual(["ledger must be an object"]);
    expect(validateLedger({}).errors).toEqual(["ledger.dismissals must be an array"]);
  });

  it("rejects bad fields, duplicates, and long comments", () => {
    const {errors} = validateLedger({
      dismissals: [
        entry(),
        entry(),
        {alert: 0, comment: "", path: "", reason: "nope", rule: ""},
        entry({alert: 3, comment: "x".repeat(281)}),
      ],
    });
    expect(errors).toContain("dismissals[1].alert #1 is listed twice");
    expect(errors).toContain("dismissals[2].alert must be a positive integer");
    expect(errors).toContain("dismissals[2].rule is required");
    expect(errors).toContain("dismissals[2].path is required");
    expect(errors.some((error) => error.startsWith("dismissals[2].reason must be one of"))).toBe(
      true
    );
    expect(errors).toContain("dismissals[2].comment is required");
    expect(errors).toContain("dismissals[3].comment is over 280 characters");
  });

  it("keeps the committed ledger valid", () => {
    const ledger = JSON.parse(readFileSync(".github/code-scanning/dismissals.json", "utf8"));
    expect(validateLedger(ledger).errors).toEqual([]);
  });
});

describe("planDismissals", () => {
  it("dismisses open alerts whose rule and path match", () => {
    const plan = planDismissals({alerts: [alert()], ledger: {dismissals: [entry()]}});
    expect(plan.dismiss.map((e) => e.alert)).toEqual([1]);
  });

  it("skips closed alerts, reports missing ones, and refuses mismatches", () => {
    const plan = planDismissals({
      alerts: [
        alert({state: "fixed"}),
        alert({number: 2, path: "api/src/other.ts"}),
        alert({number: 3, rule: {id: "js/sql-injection"}}),
      ],
      ledger: {
        dismissals: [entry(), entry({alert: 2}), entry({alert: 3}), entry({alert: 4})],
      },
    });
    expect(plan.alreadyClosed.map((e) => e.alert)).toEqual([1]);
    expect(plan.mismatched.map((m) => m.entry.alert)).toEqual([2, 3]);
    expect(plan.mismatched[0].actualPath).toBe("api/src/other.ts");
    expect(plan.mismatched[1].actualRule).toBe("js/sql-injection");
    expect(plan.missing.map((e) => e.alert)).toEqual([4]);
    expect(plan.dismiss).toEqual([]);
  });
});
