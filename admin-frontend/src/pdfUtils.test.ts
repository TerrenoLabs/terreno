import {describe, expect, it, mock} from "bun:test";
import {DateTime} from "luxon";

import {ensureSpace, formatDate, provisionalPdfSignature, provisionalSignerName} from "./pdfUtils";

describe("formatDate", () => {
  it("returns an empty string for missing values", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
  });

  it("returns the raw string when ISO parsing fails", () => {
    expect(formatDate("not-iso")).toBe("not-iso");
  });

  it("formats a valid ISO timestamp", () => {
    const iso = "2024-06-15T10:30:00Z";
    const expected = DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_FULL);
    expect(formatDate(iso)).toBe(expected);
  });
});

describe("ensureSpace", () => {
  it("adds a page and resets y when the remaining space is too small", () => {
    const addPage = mock(() => {});
    const nextY = ensureSpace({addPage} as never, 292, 40);
    expect(addPage).toHaveBeenCalled();
    expect(nextY).toBe(20);
  });

  it("keeps the current y when the content fits", () => {
    const addPage = mock(() => {});
    expect(ensureSpace({addPage} as never, 40, 8)).toBe(40);
    expect(addPage).not.toHaveBeenCalled();
  });
});

describe("provisionalSignerName", () => {
  it("uses the name, then the email, then Staff", () => {
    expect(provisionalSignerName({email: "dana@example.com", name: "Dana"})).toBe("Dana");
    expect(provisionalSignerName({email: "dana@example.com"})).toBe("dana@example.com");
    expect(provisionalSignerName("staff-1")).toBe("Staff");
    expect(provisionalSignerName(null)).toBe("Staff");
  });
});

describe("provisionalPdfSignature", () => {
  it("returns undefined without a section", () => {
    expect(provisionalPdfSignature(undefined)).toBeUndefined();
  });

  it("keeps the section and defaults a missing signedAt to an empty string", () => {
    expect(provisionalPdfSignature({note: "Phone", signedByName: "Dana"})).toEqual({
      note: "Phone",
      signedAt: "",
      signedByName: "Dana",
    });
  });
});
