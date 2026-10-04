import {describe, expect, it} from "bun:test";
import {APIError, isAPIError} from "@terreno/api";

import {HarnessDefinitionError} from "./definitionError";
import {errorMessage, HARNESS_ERRORS, harnessError} from "./errors";
import {internalRuntime} from "./internalRuntime";

describe("harness errors", () => {
  it("builds an APIError whose message is the kind's stable title", () => {
    const cause = new Error("socket hang up");
    const error = harnessError({
      cause,
      detail: "Task 1 is already completed",
      kind: "taskTerminal",
    });
    expect(isAPIError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "harness-task-terminal",
      detail: "Task 1 is already completed",
      message: "Task already ended",
      name: "HarnessTaskTerminal",
      status: 409,
    });
    expect(error.cause).toBe(cause);
    expect(error.toJSON()).toMatchObject({
      code: "harness-task-terminal",
      detail: "Task 1 is already completed",
      status: 409,
      title: "Task already ended",
    });
  });

  it("gives every kind a harness- code, an HTTP error status, and a title", () => {
    const codes = Object.values(HARNESS_ERRORS).map(({code}) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const {code, status, title} of Object.values(HARNESS_ERRORS)) {
      expect(code).toStartWith("harness-");
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(title.trim()).not.toBe("");
    }
  });

  it("keeps HarnessDefinitionError an instanceof-checkable definition APIError", () => {
    const error = new HarnessDefinitionError("defineTask: name is required");
    expect(error).toBeInstanceOf(HarnessDefinitionError);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({
      code: HARNESS_ERRORS.definitionInvalid.code,
      detail: "defineTask: name is required",
      message: HARNESS_ERRORS.definitionInvalid.title,
      name: "HarnessDefinitionError",
      status: 500,
    });
  });

  it("records a harness error by its detail and any other error with its full text", () => {
    expect(
      errorMessage(harnessError({detail: "memo requires a non-empty key", kind: "invalidRequest"}))
    ).toBe("memo requires a non-empty key");
    expect(
      errorMessage(new HarnessDefinitionError("defineTool(x): execute must be a function"))
    ).toBe("defineTool(x): execute must be a function");
    // An app's own APIError keeps its title, since its detail may not stand alone.
    expect(
      errorMessage(
        new APIError({
          code: "ehr-down",
          detail: "p-1 timed out",
          status: 502,
          title: "EHR unavailable",
        })
      )
    ).toBe("EHR unavailable: p-1 timed out");
    expect(errorMessage(new APIError({status: 404, title: "Chart not found"}))).toBe(
      "Chart not found"
    );
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain string")).toBe("plain string");
  });

  it("refuses a runtime the engine did not build", () => {
    expect(() => internalRuntime({} as never)).toThrow(
      expect.objectContaining({
        code: HARNESS_ERRORS.internal.code,
        detail: "This runtime was not built by the harness engine",
      })
    );
  });
});
