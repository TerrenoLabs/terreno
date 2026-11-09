import {describe, it} from "bun:test";
import {assert} from "chai";
import {parseObservabilityPriceMap} from "./observabilityConfig";

describe("parseObservabilityPriceMap", () => {
  it("parses a valid model price map and defaults to empty", () => {
    assert.deepEqual(parseObservabilityPriceMap(undefined), {});
    assert.deepEqual(
      parseObservabilityPriceMap('{"gemini-2.5-flash":{"inputPerMTok":0.1,"outputPerMTok":0.4}}'),
      {
        "gemini-2.5-flash": {inputPerMTok: 0.1, outputPerMTok: 0.4},
      }
    );
  });

  it("rejects malformed prices with a clear variable name", () => {
    assert.throws(() => parseObservabilityPriceMap("{bad"), /AI_OBS_PRICE_MAP_JSON/);
    assert.throws(() => parseObservabilityPriceMap("[]"), /model-to-price object/);
    assert.throws(
      () => parseObservabilityPriceMap('{"model":{"inputPerMTok":"free"}}'),
      /AI_OBS_PRICE_MAP_JSON/
    );
    assert.throws(
      () => parseObservabilityPriceMap('{"model":{"inputPerMTok":-1,"outputPerMTok":0.4}}'),
      /non-negative/
    );
  });
});
