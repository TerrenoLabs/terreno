import {expect} from "bun:test";

export interface ExpectedAPIError {
  status: number;
  title?: string | RegExp;
  detail?: string | RegExp;
  code?: string;
  /** Partial match against `meta.fields`, the per-field validation messages. */
  fields?: Record<string, unknown>;
}

interface ResponseLike {
  status: number;
  body: unknown;
}

const expectText = (actual: unknown, expected: string | RegExp): void => {
  if (expected instanceof RegExp) {
    expect(String(actual)).toMatch(expected);
    return;
  }
  expect(actual).toBe(expected);
};

/**
 * Asserts a supertest response is the JSONAPI error body `@terreno/api` sends for an `APIError`:
 * `{status, title, detail?, code?, meta?: {fields?}}`. Only the keys you pass are checked.
 */
export const expectAPIError = (res: ResponseLike, expected: ExpectedAPIError): void => {
  const body = (res.body ?? {}) as {
    code?: unknown;
    detail?: unknown;
    meta?: {fields?: unknown};
    status?: unknown;
    title?: unknown;
  };
  expect(res.status).toBe(expected.status);
  expect(body.status).toBe(expected.status);
  if (expected.title !== undefined) {
    expectText(body.title, expected.title);
  }
  if (expected.detail !== undefined) {
    expectText(body.detail, expected.detail);
  }
  if (expected.code !== undefined) {
    expect(body.code).toBe(expected.code);
  }
  if (expected.fields !== undefined) {
    expect(body.meta?.fields ?? {}).toMatchObject(expected.fields);
  }
};
