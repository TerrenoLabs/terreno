import {APIError} from "@terreno/api";

export interface ObservabilityModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const parseObservabilityPriceMap = (
  raw: string | undefined
): Record<string, ObservabilityModelPrice> => {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new APIError({status: 500, title: "AI_OBS_PRICE_MAP_JSON must be valid JSON"});
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new APIError({
      status: 500,
      title: "AI_OBS_PRICE_MAP_JSON must be a model-to-price object",
    });
  }
  const prices: Record<string, ObservabilityModelPrice> = {};
  for (const [model, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new APIError({
        status: 500,
        title: `AI_OBS_PRICE_MAP_JSON price for "${model}" must be an object`,
      });
    }
    const record = value as Record<string, unknown>;
    const inputPerMTok = record.inputPerMTok;
    const outputPerMTok = record.outputPerMTok;
    if (
      typeof inputPerMTok !== "number" ||
      !Number.isFinite(inputPerMTok) ||
      inputPerMTok < 0 ||
      typeof outputPerMTok !== "number" ||
      !Number.isFinite(outputPerMTok) ||
      outputPerMTok < 0
    ) {
      throw new APIError({
        status: 500,
        title: `AI_OBS_PRICE_MAP_JSON price for "${model}" requires non-negative inputPerMTok and outputPerMTok numbers`,
      });
    }
    prices[model] = {inputPerMTok, outputPerMTok};
  }
  return prices;
};
