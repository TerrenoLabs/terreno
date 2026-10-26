import {describe, expect, it} from "bun:test";
import {assertStrictResponseProperties, collectPropertyPaths} from "./strictResponseProperties";

describe("collectPropertyPaths", () => {
  it("walks nested objects and array items without index segments", () => {
    expect(
      collectPropertyPaths({data: [{email: "a"}, {email: "b", name: "c"}], meta: {page: 1}})
    ).toEqual(["data", "data.email", "data.name", "meta", "meta.page"]);
  });

  it("returns nothing for primitives", () => {
    expect(collectPropertyPaths("text")).toEqual([]);
    expect(collectPropertyPaths(null)).toEqual([]);
  });
});

describe("assertStrictResponseProperties", () => {
  const body = {
    data: [{_id: "1", address: {city: "Austin", zip: "78701"}, profile: {name: {first: "A"}}}],
    more: false,
  };

  it("allows listed paths, their ancestors, and anything under them", () => {
    assertStrictResponseProperties(body, [
      "data._id",
      "data.address",
      "data.profile.name.first",
      "more",
    ]);
  });

  it("names every unexpected path", () => {
    expect(() => assertStrictResponseProperties(body, ["data._id", "more"])).toThrow(
      "Unexpected field(s) in response: data.address, data.address.city, data.address.zip, data.profile, data.profile.name, data.profile.name.first"
    );
  });
});
