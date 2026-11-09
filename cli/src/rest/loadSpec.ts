import {readFile} from "node:fs/promises";

import type {OpenApiDocument} from "./operations";

const looksLikeYaml = (text: string): boolean => {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("openapi:") ||
    trimmed.startsWith("swagger:") ||
    (trimmed.includes("\n") && !trimmed.startsWith("{"))
  );
};

export const parseOpenApiDocument = (raw: string): OpenApiDocument => {
  const text = raw.trim();
  if (!text) {
    throw new Error("OpenAPI document is empty");
  }
  if (looksLikeYaml(text) && !text.startsWith("{") && !text.startsWith("[")) {
    const parsed = Bun.YAML.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("OpenAPI YAML did not parse to an object");
    }
    return parsed as OpenApiDocument;
  }
  return JSON.parse(text) as OpenApiDocument;
};

export const loadOpenApiDocument = async (
  source: string,
  fetchImpl: typeof fetch = fetch
): Promise<OpenApiDocument> => {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetchImpl(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec ${source}: HTTP ${response.status}`);
    }
    return parseOpenApiDocument(await response.text());
  }
  const file = await readFile(source, "utf8");
  return parseOpenApiDocument(file);
};

export const defaultBaseUrl = (spec: OpenApiDocument, override?: string): string => {
  if (override) {
    return override.replace(/\/$/, "");
  }
  const fromSpec = spec.servers?.[0]?.url;
  if (fromSpec) {
    return fromSpec.replace(/\/$/, "");
  }
  return "";
};
