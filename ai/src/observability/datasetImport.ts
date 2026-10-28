import {APIError} from "@terreno/api";
import {parse} from "csv-parse/sync";

import {setValueAtPath} from "./jsonPath";

interface StructuredDatasetImportRow {
  expectedOutput?: unknown;
  input?: unknown;
  metadata?: Record<string, unknown>;
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread?: boolean;
  tags?: string[];
}

export interface ParsedDatasetImportRow {
  expectedOutput?: unknown;
  input: unknown;
  metadata?: Record<string, unknown>;
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread?: boolean;
  tags: string[];
}

const parseBooleanCell = (value: string | undefined): boolean | undefined => {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
};

const parseTagsCell = (value: string | undefined): string[] => {
  if (!value || value.trim() === "") {
    return [];
  }
  return value
    .split("|")
    .map((tag) => {
      return tag.trim();
    })
    .filter((tag) => {
      return tag.length > 0;
    });
};

const coerceCellValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

const rowFromStructured = (row: StructuredDatasetImportRow): ParsedDatasetImportRow => {
  if (row.input === undefined) {
    throw new APIError({status: 400, title: "structured import row requires input"});
  }
  return {
    expectedOutput: row.expectedOutput,
    input: row.input,
    metadata: row.metadata,
    outcomeClass: row.outcomeClass,
    proofread: row.proofread,
    tags: row.tags ?? [],
  };
};

const rowFromBareObject = (row: Record<string, unknown>): ParsedDatasetImportRow => {
  const {expectedOutput, metadata, outcomeClass, proofread, tags, ...input} = row;
  return {
    expectedOutput,
    input,
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : undefined,
    outcomeClass:
      outcomeClass === "fn" ||
      outcomeClass === "fp" ||
      outcomeClass === "tn" ||
      outcomeClass === "tp"
        ? outcomeClass
        : undefined,
    proofread: typeof proofread === "boolean" ? proofread : undefined,
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => {
          return typeof tag === "string";
        })
      : [],
  };
};

const rowFromCsvRecord = (record: Record<string, string>): ParsedDatasetImportRow => {
  const input: Record<string, unknown> = {};
  const expectedOutput: Record<string, unknown> = {};
  let explicitExpectedOutput: unknown;
  let explicitInput: unknown;
  let proofread: boolean | undefined;
  let outcomeClass: ParsedDatasetImportRow["outcomeClass"];
  let tags: string[] = [];

  for (const [column, rawValue] of Object.entries(record)) {
    if (column === "proofread") {
      proofread = parseBooleanCell(rawValue);
      continue;
    }
    if (column === "tags") {
      tags = parseTagsCell(rawValue);
      continue;
    }
    if (column === "outcomeClass") {
      const normalized = rawValue?.trim();
      if (
        normalized === "fn" ||
        normalized === "fp" ||
        normalized === "tn" ||
        normalized === "tp"
      ) {
        outcomeClass = normalized;
      }
      continue;
    }
    if (column === "input") {
      explicitInput = coerceCellValue(rawValue);
      continue;
    }
    if (column === "expectedOutput") {
      explicitExpectedOutput = coerceCellValue(rawValue);
      continue;
    }
    if (column.startsWith("input.")) {
      setValueAtPath(input, column.slice("input.".length), coerceCellValue(rawValue));
      continue;
    }
    if (column.startsWith("expectedOutput.")) {
      setValueAtPath(
        expectedOutput,
        column.slice("expectedOutput.".length),
        coerceCellValue(rawValue)
      );
      continue;
    }
    input[column] = coerceCellValue(rawValue);
  }

  const hasExpectedOutput = Object.keys(expectedOutput).length > 0;
  return {
    expectedOutput:
      explicitExpectedOutput !== undefined
        ? explicitExpectedOutput
        : hasExpectedOutput
          ? expectedOutput
          : undefined,
    input:
      explicitInput !== undefined ? explicitInput : Object.keys(input).length > 0 ? input : record,
    outcomeClass,
    proofread,
    tags,
  };
};

export const parseDatasetJsonImport = (payload: unknown): ParsedDatasetImportRow[] => {
  if (!Array.isArray(payload)) {
    throw new APIError({status: 400, title: "JSON import must be an array"});
  }
  return payload.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new APIError({status: 400, title: `import row ${index + 1} must be an object`});
    }
    const record = row as Record<string, unknown>;
    if ("input" in record) {
      return rowFromStructured(record as StructuredDatasetImportRow);
    }
    return rowFromBareObject(record);
  });
};

export const parseDatasetCsvImport = (content: string): ParsedDatasetImportRow[] => {
  const records = parse(content, {
    columns: true,
    relaxQuotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  return records.map((record) => {
    return rowFromCsvRecord(record);
  });
};

export const flattenValidationPath = (path: string): string => {
  if (!path || path === "/") {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
};
