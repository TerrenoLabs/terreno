export interface ImportPayload {
  body: {content: string; format: "csv"} | {rows: unknown};
  formatLabel: "csv" | "json";
}

const buildJsonImportPayload = (parsed: unknown): ImportPayload => {
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return {
    body: {rows},
    formatLabel: "json",
  };
};

export const buildCsvImportPayload = (content: string): ImportPayload => {
  return {
    body: {content, format: "csv"},
    formatLabel: "csv",
  };
};

export const parseImportText = (text: string, formatLabel: "csv" | "json"): ImportPayload => {
  if (formatLabel === "csv") {
    return buildCsvImportPayload(text);
  }
  const parsed = JSON.parse(text) as unknown;
  return buildJsonImportPayload(parsed);
};

export const detectImportFormat = (filename: string, content: string): "csv" | "json" => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  if (lower.endsWith(".json")) {
    return "json";
  }
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return "json";
  }
  return "csv";
};
