import {describe, expect, it} from "bun:test";

import {compileSort, sortSpecToParam} from "./sort";
import {compileWhere, encodeQueryParams} from "./where";

const matches = (where: Parameters<typeof compileWhere>[0], data: unknown): boolean | undefined =>
  compileWhere(where).match?.(data);

describe("compileWhere", () => {
  it("matches equality, booleans, and dot paths", () => {
    expect(matches({status: "open"}, {status: "open"})).toBe(true);
    expect(matches({status: "open"}, {status: "closed"})).toBe(false);
    expect(matches({archived: false}, {archived: false})).toBe(true);
    expect(matches({"author.id": "u1"}, {author: {id: "u1"}})).toBe(true);
  });

  it("treats an array field as containing the value", () => {
    expect(matches({tags: "urgent"}, {tags: ["a", "urgent"]})).toBe(true);
    expect(matches({tags: "urgent"}, {tags: ["a"]})).toBe(false);
  });

  it("evaluates comparison and set operators", () => {
    const data = {count: 5, created: "2026-05-01T00:00:00.000Z", status: "open"};
    expect(matches({count: {$gt: 4, $lte: 5}}, data)).toBe(true);
    expect(matches({count: {$lt: 5}}, data)).toBe(false);
    expect(matches({created: {$gte: "2026-04-01T00:00:00.000Z"}}, data)).toBe(true);
    expect(matches({created: {$gte: new Date("2026-06-01T00:00:00.000Z")}}, data)).toBe(false);
    expect(matches({status: {$in: ["open", "pending"]}}, data)).toBe(true);
    expect(matches({status: {$nin: ["open"]}}, data)).toBe(false);
    expect(matches({status: {$ne: "closed"}}, data)).toBe(true);
    expect(matches({missing: {$exists: false}}, data)).toBe(true);
  });

  it("evaluates $and / $or", () => {
    const where = {$or: [{status: "open"}, {$and: [{status: "closed"}, {count: {$gt: 10}}]}]};
    expect(matches(where, {count: 1, status: "open"})).toBe(true);
    expect(matches(where, {count: 11, status: "closed"})).toBe(true);
    expect(matches(where, {count: 1, status: "closed"})).toBe(false);
  });

  it("matches null against missing fields like Mongo", () => {
    expect(matches({archivedAt: null}, {})).toBe(true);
    expect(matches({archivedAt: null}, {archivedAt: null})).toBe(true);
    expect(matches({archivedAt: null}, {archivedAt: "2026-01-01"})).toBe(false);
  });

  it("is inexact for operators only the server can run", () => {
    expect(compileWhere({$search: "hello"}).match).toBeUndefined();
    expect(compileWhere({title: {$regex: "^a"}}).match).toBeUndefined();
  });
});

describe("encodeQueryParams", () => {
  it("emits qs bracket notation for operators and arrays", () => {
    const query = decodeURIComponent(
      encodeQueryParams({
        limit: 20,
        status: {$in: ["open", "pending"]},
        threadId: "t1",
      })
    );
    expect(query).toBe("limit=20&status[$in][0]=open&status[$in][1]=pending&threadId=t1");
  });
});

describe("compileWhere operator coverage", () => {
  it("handles $eq, $exists, and failing comparisons", () => {
    expect(matches({a: {$eq: 1}}, {a: 1})).toBe(true);
    expect(matches({a: {$eq: 1}}, {a: 2})).toBe(false);
    expect(matches({a: {$exists: true}}, {})).toBe(false);
    expect(matches({a: {$exists: "true"}}, {a: 0})).toBe(true);
    expect(matches({a: {$in: "x"}}, {a: "x"})).toBe(true);
    expect(matches({a: {$nin: "x"}}, {a: "y"})).toBe(true);
    expect(matches({a: {$gt: 5}}, {a: 5})).toBe(false);
    expect(matches({a: {$gte: 6}}, {a: 5})).toBe(false);
    expect(matches({a: {$lt: 5}}, {a: 6})).toBe(false);
    expect(matches({a: {$lte: 4}}, {a: 5})).toBe(false);
    expect(matches({a: {$gt: 1}}, {})).toBe(false);
    expect(matches({a: {$gt: 1}}, {a: null})).toBe(false);
  });

  it("compares numeric strings, mixed types, and equal strings", () => {
    expect(matches({a: "5"}, {a: 5})).toBe(true);
    expect(matches({a: {$gt: "4"}}, {a: 5})).toBe(true);
    expect(matches({a: {$gt: "x"}}, {a: 5})).toBe(false);
    expect(matches({a: {$gte: "b"}}, {a: "b"})).toBe(true);
    expect(matches({a: {$lt: "b"}}, {a: "a"})).toBe(true);
    expect(matches({"a.b": 1}, {a: "flat"})).toBe(false);
  });

  it("normalizes Luxon-like values with toISO", () => {
    const luxonLike = {toISO: (): string => "2026-01-01T00:00:00.000Z"};
    expect(matches({created: {$gte: luxonLike}}, {created: "2026-02-01T00:00:00.000Z"})).toBe(true);
  });

  it("is inexact for malformed or ambiguous filters", () => {
    expect(compileWhere({$and: {a: 1} as never}).match).toBeUndefined();
    expect(compileWhere({$or: [{a: {$regex: "x"}}]}).match).toBeUndefined();
    expect(compileWhere({nested: {a: 1}}).match).toBeUndefined();
    expect(compileWhere({a: undefined}).match?.({})).toBe(true);
    expect(compileWhere(undefined).match?.({})).toBe(true);
  });
});

describe("encodeQueryParams values", () => {
  it("encodes dates, nulls, and skips undefined", () => {
    expect(
      decodeURIComponent(
        encodeQueryParams({a: undefined, b: null, c: new Date("2026-01-01T00:00:00.000Z")})
      )
    ).toBe("b=null&c=2026-01-01T00:00:00.000Z");
  });
});

describe("compileSort value ranks", () => {
  it("orders missing < numbers < strings < booleans < objects", () => {
    const rows = [{v: {x: 1}}, {v: true}, {v: "s"}, {v: 2}, {}, {v: 1}, {v: false}];
    const sorted = [...rows].sort(compileSort({v: 1}));
    expect(sorted).toEqual([{}, {v: 1}, {v: 2}, {v: "s"}, {v: false}, {v: true}, {v: {x: 1}}]);
  });

  it("treats equal objects and two missing values as ties", () => {
    const compare = compileSort<Record<string, unknown>>({v: -1});
    expect(compare({v: {a: 1}}, {v: {a: 1}})).toBe(0);
    expect(compare({v: {a: 1}}, {v: {b: 1}})).not.toBe(0);
    expect(compare({}, {v: undefined})).toBe(0);
    expect(compileSort("a.b")({a: "flat"}, {a: {b: 1}})).toBeLessThan(0);
  });
});

describe("encodeQueryParams empty arrays", () => {
  it("throws instead of silently dropping an empty array", () => {
    expect(() => encodeQueryParams({$or: [{a: {$in: []}}]})).toThrow(/empty array/);
  });
});

describe("compileSort", () => {
  it("sorts by multiple keys from a string spec", () => {
    const rows = [
      {created: "2026-01-02", name: "b"},
      {created: "2026-01-03", name: "a"},
      {created: "2026-01-02", name: "a"},
    ];
    const sorted = [...rows].sort(compileSort("-created name"));
    expect(sorted).toEqual([
      {created: "2026-01-03", name: "a"},
      {created: "2026-01-02", name: "a"},
      {created: "2026-01-02", name: "b"},
    ]);
  });

  it("normalizes object specs to the modelRouter sort param", () => {
    expect(sortSpecToParam({created: "descending", name: "ascending"})).toBe("-created name");
  });
});
