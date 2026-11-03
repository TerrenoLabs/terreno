import {describe, expect, it} from "bun:test";

import {unexpectedPageErrors} from "./e2e/pageErrors";

const HYDRATION_418 =
  "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";

describe("unexpectedPageErrors", () => {
  it("drops React's recoverable hydration errors, as the demo export raises on every route", () => {
    expect(
      unexpectedPageErrors([
        HYDRATION_418,
        HYDRATION_418,
        "Minified React error #423; visit https://react.dev/errors/423",
        "Minified React error #425; visit https://react.dev/errors/425",
      ])
    ).toEqual([]);
  });

  it("keeps every other page error, including other React errors", () => {
    expect(
      unexpectedPageErrors([
        HYDRATION_418,
        "TypeError: Cannot read properties of undefined (reading 'map')",
        "Minified React error #185; visit https://react.dev/errors/185",
      ])
    ).toEqual([
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "Minified React error #185; visit https://react.dev/errors/185",
    ]);
  });

  it("does not treat a message that only mentions a hydration code as recoverable", () => {
    expect(unexpectedPageErrors(["Error: saw Minified React error #418; earlier"])).toEqual([
      "Error: saw Minified React error #418; earlier",
    ]);
  });
});
