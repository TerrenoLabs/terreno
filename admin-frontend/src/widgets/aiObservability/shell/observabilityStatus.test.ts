import {describe, expect, it} from "bun:test";
import {
  AGREEMENT_LEVEL_STYLE,
  formatRate,
  getAgreementLevel,
  getObservabilityStatusStyle,
  toMeterWidth,
} from "./observabilityStatus";

describe("getObservabilityStatusStyle", () => {
  it("maps every status to one tone, label, and icon", () => {
    expect(getObservabilityStatusStyle({status: "pending"})).toEqual({
      iconName: "clock",
      label: "Pending",
      tone: "neutral",
    });
    expect(getObservabilityStatusStyle({status: "in_progress"}).tone).toBe("info");
    expect(getObservabilityStatusStyle({status: "running"}).tone).toBe("info");
    expect(getObservabilityStatusStyle({status: "skipped"}).label).toBe("Skipped");
    expect(getObservabilityStatusStyle({status: "failed"}).tone).toBe("error");
    expect(getObservabilityStatusStyle({status: "error"}).label).toBe("Error");
    expect(getObservabilityStatusStyle({status: "ok"}).tone).toBe("success");
  });

  it("labels done and completed the same way", () => {
    expect(getObservabilityStatusStyle({status: "done"})).toEqual(
      getObservabilityStatusStyle({status: "completed"})
    );
  });

  it("falls back to a neutral, readable badge for unknown or missing statuses", () => {
    expect(getObservabilityStatusStyle({status: "needs_review"})).toEqual({
      iconName: "circle-info",
      label: "Needs review",
      tone: "neutral",
    });
    expect(getObservabilityStatusStyle({status: "__"}).label).toBe("Unknown");
    expect(getObservabilityStatusStyle({}).label).toBe("Unknown");
  });
});

describe("getAgreementLevel", () => {
  it("uses the shared thresholds", () => {
    expect(getAgreementLevel(0.9)).toBe("match");
    expect(getAgreementLevel(0.97)).toBe("match");
    expect(getAgreementLevel(0.89)).toBe("close");
    expect(getAgreementLevel(0.75)).toBe("close");
    expect(getAgreementLevel(0.74)).toBe("off");
    expect(getAgreementLevel(0.5)).toBe("off");
  });

  it("returns none when there is nothing to compare", () => {
    expect(getAgreementLevel(undefined)).toBe("none");
    expect(getAgreementLevel(Number.NaN)).toBe("none");
    expect(AGREEMENT_LEVEL_STYLE.none.tone).toBe("neutral");
  });
});

describe("formatRate and toMeterWidth", () => {
  it("formats rates as whole percents", () => {
    expect(formatRate(0.968)).toBe("97%");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
  });

  it("clamps meter widths", () => {
    expect(toMeterWidth(0.8)).toBe("80%");
    expect(toMeterWidth(1.4)).toBe("100%");
    expect(toMeterWidth(-1)).toBe("0%");
    expect(toMeterWidth(undefined)).toBe("0%");
    expect(toMeterWidth(Number.NaN)).toBe("0%");
  });
});
