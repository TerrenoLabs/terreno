import {describe, expect, it} from "bun:test";
import {expectAPIError} from "./expectAPIError";

const errorResponse = {
  body: {
    code: "action-body-validation-failed",
    detail: "One or more fields are invalid",
    meta: {fields: {email: "Invalid email", name: "Required"}},
    status: 400,
    title: "Validation failed",
  },
  status: 400,
};

describe("expectAPIError", () => {
  it("passes when every given key matches", () => {
    expectAPIError(errorResponse, {
      code: "action-body-validation-failed",
      detail: /fields are invalid/,
      fields: {email: "Invalid email"},
      status: 400,
      title: "Validation failed",
    });
  });

  it("checks only the status when nothing else is given", () => {
    expectAPIError({body: {status: 404, title: "Not found"}, status: 404}, {status: 404});
  });

  it("fails on a status, title, code, or field mismatch", () => {
    expect(() => expectAPIError(errorResponse, {status: 403})).toThrow();
    expect(() => expectAPIError(errorResponse, {status: 400, title: "Other"})).toThrow();
    expect(() => expectAPIError(errorResponse, {status: 400, title: /^Other/})).toThrow();
    expect(() => expectAPIError(errorResponse, {code: "x", status: 400})).toThrow();
    expect(() =>
      expectAPIError(errorResponse, {fields: {phone: "Required"}, status: 400})
    ).toThrow();
  });

  it("fails when the body has no fields but fields were expected", () => {
    expect(() =>
      expectAPIError(
        {body: {status: 400, title: "Bad"}, status: 400},
        {fields: {a: "b"}, status: 400}
      )
    ).toThrow();
    expect(() => expectAPIError({body: undefined, status: 400}, {status: 400})).toThrow();
  });
});
