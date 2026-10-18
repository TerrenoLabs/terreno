import {describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import {AdminAPIError} from "../../adminRequest";
import {
  approvalId,
  describeRequestError,
  formatDateTime,
  formatPayload,
  hasPayload,
  looksLikeMarkdown,
  relativeTime,
  taskLabel,
  unwrapApprovalList,
} from "./harnessApprovalTypes";

describe("harness approval helpers", () => {
  it("reads the id from id or _id", () => {
    expect(approvalId({id: "a", title: "t"})).toBe("a");
    expect(approvalId({_id: "b", title: "t"})).toBe("b");
    expect(approvalId({title: "t"})).toBe("");
  });

  it("unwraps a list envelope or a bare array, else empty", () => {
    expect(unwrapApprovalList({data: [{title: "x"}]})).toEqual([{title: "x"}]);
    expect(unwrapApprovalList([{title: "y"}])).toEqual([{title: "y"}]);
    expect(unwrapApprovalList(undefined)).toEqual([]);
    expect(unwrapApprovalList({data: "nope"})).toEqual([]);
  });

  it("labels the task as name@version from the definition key", () => {
    expect(taskLabel("clinic.intake@3:clinician-signoff")).toBe("clinic.intake@3");
    expect(taskLabel("terreno.agent.tool@1:writeNote")).toBe("terreno.agent.tool@1");
    expect(taskLabel("odd-key")).toBe("odd-key");
    expect(taskLabel(undefined)).toBe("Unknown task");
  });

  it("formats times with Luxon and tolerates missing or invalid values", () => {
    const iso = DateTime.now().minus({hours: 2}).toISO() ?? "";
    expect(relativeTime(iso)).toBe("2 hours ago");
    expect(relativeTime(undefined)).toBe("");
    expect(relativeTime("not a date")).toBe("");
    expect(formatDateTime(iso)).toBe(DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_MED));
    expect(formatDateTime(undefined)).toBe("");
    expect(formatDateTime("not a date")).toBe("");
  });

  it("detects markdown summaries", () => {
    expect(looksLikeMarkdown("# Title")).toBe(true);
    expect(looksLikeMarkdown("- item")).toBe(true);
    expect(looksLikeMarkdown("1. first")).toBe(true);
    expect(looksLikeMarkdown("a **bold** word")).toBe(true);
    expect(looksLikeMarkdown("run `cmd`")).toBe(true);
    expect(looksLikeMarkdown("see [docs](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("Patient 123 needs sign-off.")).toBe(false);
  });

  it("pretty-prints payloads and passes strings through", () => {
    expect(formatPayload({a: 1})).toBe('{\n  "a": 1\n}');
    expect(formatPayload("raw")).toBe("raw");
    expect(formatPayload({big: BigInt(7)})).toBe("[object Object]");
    expect(formatPayload(undefined)).toBe("");
  });

  it("treats null, undefined, and empty objects as no payload", () => {
    expect(hasPayload(undefined)).toBe(false);
    expect(hasPayload(null)).toBe(false);
    expect(hasPayload({})).toBe(false);
    expect(hasPayload({a: 1})).toBe(true);
    expect(hasPayload("text")).toBe(true);
  });

  it("describes AdminAPIError, plain errors, and unknown values", () => {
    expect(describeRequestError(new AdminAPIError({status: 409, title: "Taken"}))).toEqual({
      status: 409,
      title: "Taken",
    });
    expect(describeRequestError(new Error("Network down"))).toEqual({
      status: undefined,
      title: "Network down",
    });
    expect(describeRequestError("boom")).toEqual({title: "Something went wrong"});
    expect(describeRequestError({data: {title: ""}})).toEqual({title: "Something went wrong"});
  });
});
