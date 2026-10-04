import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {ObsDatasetAnnotatedBy, ObsDatasetItemDocument} from "../../types/observability";
import {
  flattenValidationPath,
  type ParsedDatasetImportRow,
  parseDatasetCsvImport,
  parseDatasetJsonImport,
} from "../datasetImport";
import {validateAgainstSchema} from "../schemaValidation";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsDatasetItem} from "./models/obsDatasetItem";
import {registerObsTrace} from "./models/obsTrace";
import {LocalPromptStore} from "./promptStore";

export interface DatasetWriteInput {
  description?: string | null;
  expectedOutputSchema?: Record<string, unknown> | null;
  inputSchemaPromptName?: string | null;
  name: string;
  tags?: string[];
}

export interface DatasetItemWriteInput {
  expectedOutput?: unknown | null;
  input: unknown;
  metadata?: Record<string, unknown> | null;
  origin?: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp" | null;
  proofread?: boolean;
  sourceTraceId?: string;
  tags?: string[];
}

export interface DatasetCounts {
  auto: number;
  human: number;
  needsReview: number;
  total: number;
}

export interface DatasetView {
  counts: DatasetCounts;
  created: string;
  description?: string;
  expectedOutputSchema?: Record<string, unknown>;
  id: string;
  inputSchemaPromptName?: string;
  name: string;
  tags: string[];
  updated: string;
}

export interface DatasetItemView {
  annotatedBy?: ObsDatasetAnnotatedBy;
  created: string;
  datasetId: string;
  expectedOutput?: unknown;
  id: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread: boolean;
  sourceTraceId?: string;
  tags: string[];
  updated: string;
}

export interface DatasetImportResult {
  created: number;
  errors: Array<{message: string; path?: string; row: number}>;
}

export const throwOnDatasetImportErrors = (result: DatasetImportResult): void => {
  const first = result.errors[0];
  if (!first) {
    return;
  }
  throw new APIError({
    status: 400,
    title: `Import failed on row ${first.row}: ${first.path ?? ""} ${first.message}`.trim(),
  });
};

const toDatasetView = async (doc: {
  _id: mongoose.Types.ObjectId;
  created: Date;
  description?: string;
  expectedOutputSchema?: Record<string, unknown>;
  inputSchemaPromptName?: string;
  name: string;
  tags: string[];
  updated: Date;
}): Promise<DatasetView> => {
  const counts = await computeDatasetCounts(String(doc._id));
  return {
    counts,
    created: DateTime.fromJSDate(doc.created).toUTC().toISO() ?? "",
    description: doc.description,
    expectedOutputSchema: doc.expectedOutputSchema,
    id: String(doc._id),
    inputSchemaPromptName: doc.inputSchemaPromptName,
    name: doc.name,
    tags: doc.tags,
    updated: DateTime.fromJSDate(doc.updated).toUTC().toISO() ?? "",
  };
};

const toItemView = (doc: {
  _id: mongoose.Types.ObjectId;
  annotatedBy?: ObsDatasetAnnotatedBy;
  created: Date;
  datasetId: mongoose.Types.ObjectId;
  expectedOutput?: unknown;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread: boolean;
  sourceTraceId?: mongoose.Types.ObjectId;
  tags: string[];
  updated: Date;
}): DatasetItemView => {
  return {
    annotatedBy: doc.annotatedBy,
    created: DateTime.fromJSDate(doc.created).toUTC().toISO() ?? "",
    datasetId: String(doc.datasetId),
    expectedOutput: doc.expectedOutput,
    id: String(doc._id),
    input: doc.input,
    metadata: doc.metadata,
    origin: doc.origin,
    outcomeClass: doc.outcomeClass,
    proofread: doc.proofread,
    sourceTraceId: doc.sourceTraceId ? String(doc.sourceTraceId) : undefined,
    tags: doc.tags,
    updated: DateTime.fromJSDate(doc.updated).toUTC().toISO() ?? "",
  };
};

const computeDatasetCounts = async (datasetId: string): Promise<DatasetCounts> => {
  const ObsDatasetItem = registerObsDatasetItem();
  const objectId = new mongoose.Types.ObjectId(datasetId);
  const [total, human, auto, needsReview] = await Promise.all([
    ObsDatasetItem.countDocuments({datasetId: objectId}),
    ObsDatasetItem.countDocuments({datasetId: objectId, proofread: true}),
    ObsDatasetItem.countDocuments({
      datasetId: objectId,
      origin: {$in: ["synthetic", "trace"]},
      proofread: false,
    }),
    ObsDatasetItem.countDocuments({datasetId: objectId, proofread: false}),
  ]);
  return {
    auto,
    human,
    needsReview,
    total,
  };
};

export class LocalDatasetStore {
  constructor(private readonly promptStore = new LocalPromptStore()) {}

  async create(input: DatasetWriteInput): Promise<DatasetView> {
    if (!input.name) {
      throw new APIError({status: 400, title: "dataset name is required"});
    }
    try {
      const created = await registerObsDataset().create({
        description: input.description ?? undefined,
        expectedOutputSchema: input.expectedOutputSchema ?? undefined,
        inputSchemaPromptName: input.inputSchemaPromptName ?? undefined,
        name: input.name,
        tags: input.tags ?? [],
      });
      return toDatasetView(created);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as {code?: number}).code === 11000
      ) {
        throw new APIError({status: 409, title: `Dataset "${input.name}" already exists`});
      }
      throw error;
    }
  }

  async list(): Promise<DatasetView[]> {
    const rows = await registerObsDataset().find({}).sort({name: 1});
    return Promise.all(
      rows.map((row) => {
        return toDatasetView(row);
      })
    );
  }

  async get(id: string): Promise<DatasetView> {
    const doc = await registerObsDataset().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown dataset "${id}"`});
    }
    return toDatasetView(doc);
  }

  async update(id: string, input: Partial<DatasetWriteInput>): Promise<DatasetView> {
    const doc = await registerObsDataset().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown dataset "${id}"`});
    }
    if (input.description !== undefined) {
      doc.description = input.description ?? undefined;
    }
    if (input.expectedOutputSchema !== undefined) {
      doc.expectedOutputSchema = input.expectedOutputSchema ?? undefined;
    }
    if (input.inputSchemaPromptName !== undefined) {
      doc.inputSchemaPromptName = input.inputSchemaPromptName ?? undefined;
    }
    doc.name = input.name ?? doc.name;
    doc.tags = input.tags ?? doc.tags;
    await doc.save();
    return toDatasetView(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await registerObsDataset().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown dataset "${id}"`});
    }
    doc.deleted = true;
    await doc.save();
    await registerObsDatasetItem().updateMany({datasetId: doc._id}, {deleted: true});
  }

  async listItems(datasetId: string): Promise<DatasetItemView[]> {
    await this.get(datasetId);
    const rows = await registerObsDatasetItem().find({datasetId}).sort({created: -1});
    return rows.map((row) => {
      return toItemView(row);
    });
  }

  async createItem(datasetId: string, input: DatasetItemWriteInput): Promise<DatasetItemView> {
    const dataset = await registerObsDataset().findOneOrNone({_id: datasetId});
    if (!dataset) {
      throw new APIError({status: 404, title: `Unknown dataset "${datasetId}"`});
    }
    await this.validateItemInput(dataset, input.input, 1);
    const created = await registerObsDatasetItem().create({
      datasetId: dataset._id,
      expectedOutput: input.expectedOutput ?? undefined,
      input: input.input,
      metadata: input.metadata ?? undefined,
      origin: input.origin ?? "manual",
      outcomeClass: input.outcomeClass ?? undefined,
      proofread: input.proofread ?? false,
      sourceTraceId: input.sourceTraceId,
      tags: input.tags ?? [],
    });
    return toItemView(created);
  }

  async updateItem(
    datasetId: string,
    itemId: string,
    input: Partial<DatasetItemWriteInput>
  ): Promise<DatasetItemView> {
    const doc = await registerObsDatasetItem().findOneOrNone({_id: itemId, datasetId});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown dataset item "${itemId}"`});
    }
    if (input.input !== undefined) {
      const dataset = await registerObsDataset().findOneOrNone({_id: datasetId});
      if (!dataset) {
        throw new APIError({status: 404, title: `Unknown dataset "${datasetId}"`});
      }
      await this.validateItemInput(dataset, input.input, 1);
      doc.input = input.input;
    }
    if (input.expectedOutput !== undefined) {
      doc.expectedOutput = input.expectedOutput ?? undefined;
    }
    if (input.metadata !== undefined) {
      doc.metadata = input.metadata ?? undefined;
    }
    if (input.outcomeClass !== undefined) {
      doc.outcomeClass = input.outcomeClass ?? undefined;
    }
    if (input.proofread !== undefined) {
      doc.proofread = input.proofread;
    }
    doc.tags = input.tags ?? doc.tags;
    await doc.save();
    return toItemView(doc);
  }

  async removeItem(datasetId: string, itemId: string): Promise<void> {
    const doc = await registerObsDatasetItem().findOneOrNone({_id: itemId, datasetId});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown dataset item "${itemId}"`});
    }
    doc.deleted = true;
    await doc.save();
  }

  async importRows(
    datasetId: string,
    rows: ParsedDatasetImportRow[],
    origin: "manual" | "synthetic" | "trace" = "manual"
  ): Promise<DatasetImportResult> {
    const dataset = await registerObsDataset().findOneOrNone({_id: datasetId});
    if (!dataset) {
      throw new APIError({status: 404, title: `Unknown dataset "${datasetId}"`});
    }
    const errors: DatasetImportResult["errors"] = [];
    const validRows: ParsedDatasetImportRow[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = index + 1;
      const validationErrors = await this.validateItemInput(dataset, row.input, rowNumber, false);
      if (validationErrors.length > 0) {
        errors.push(...validationErrors);
        continue;
      }
      validRows.push(row);
    }
    if (errors.length > 0) {
      return {created: 0, errors};
    }
    const createdItems: ObsDatasetItemDocument[] = [];
    for (const row of validRows) {
      createdItems.push(
        await registerObsDatasetItem().create({
          datasetId: dataset._id,
          expectedOutput: row.expectedOutput,
          input: row.input,
          metadata: row.metadata,
          origin,
          outcomeClass: row.outcomeClass,
          proofread: row.proofread ?? false,
          tags: row.tags,
        })
      );
    }
    return {created: createdItems.length, errors: []};
  }

  async importJson(datasetId: string, payload: unknown): Promise<DatasetImportResult> {
    const rows = parseDatasetJsonImport(payload);
    return this.importRows(datasetId, rows);
  }

  async importCsv(datasetId: string, content: string): Promise<DatasetImportResult> {
    const rows = parseDatasetCsvImport(content);
    return this.importRows(datasetId, rows);
  }

  async addTraceToDataset(params: {datasetId: string; traceId: string}): Promise<DatasetItemView> {
    const result = await this.addTracesToDataset({
      datasetId: params.datasetId,
      traceIds: [params.traceId],
    });
    const first = result[0];
    if (!first) {
      throw new APIError({status: 404, title: `Unknown trace "${params.traceId}"`});
    }
    return first;
  }

  async addTracesToDataset(params: {
    datasetId: string;
    traceIds: string[];
  }): Promise<DatasetItemView[]> {
    const dataset = await registerObsDataset().findOneOrNone({_id: params.datasetId});
    if (!dataset) {
      throw new APIError({status: 404, title: `Unknown dataset "${params.datasetId}"`});
    }
    const created: DatasetItemView[] = [];
    for (const traceId of params.traceIds) {
      const trace = await registerObsTrace().findOneOrNone({_id: traceId});
      if (!trace) {
        throw new APIError({status: 404, title: `Unknown trace "${traceId}"`});
      }
      const input = trace.input ?? {};
      await this.validateItemInput(dataset, input, 1);
      const item = await registerObsDatasetItem().create({
        datasetId: dataset._id,
        expectedOutput: trace.output,
        input,
        origin: "trace",
        proofread: !trace.sensitive,
        sourceTraceId: trace._id,
        tags: [],
      });
      created.push(toItemView(item));
    }
    return created;
  }

  async listExperimentItems(
    datasetId: string,
    includeUnproofread: boolean
  ): Promise<DatasetItemView[]> {
    const filter: Record<string, unknown> = {datasetId};
    if (!includeUnproofread) {
      filter.proofread = true;
    }
    const rows = await registerObsDatasetItem().find(filter).sort({created: 1});
    return rows.map((row) => {
      return toItemView(row);
    });
  }

  private async validateItemInput(
    dataset: {inputSchemaPromptName?: string},
    input: unknown,
    row: number,
    throwOnError = true
  ): Promise<DatasetImportResult["errors"]> {
    if (!dataset.inputSchemaPromptName) {
      return [];
    }
    const promptVersion = await this.promptStore.getVersionByLabel(
      dataset.inputSchemaPromptName,
      "production"
    );
    if (!promptVersion?.inputSchema) {
      return [];
    }
    const errors = validateAgainstSchema(promptVersion.inputSchema, input).map((error) => {
      return {
        message: error.message,
        path: flattenValidationPath(error.path),
        row,
      };
    });
    if (errors.length > 0 && throwOnError) {
      const first = errors[0];
      throw new APIError({
        status: 400,
        title: `Row ${first.row} failed input schema at ${first.path}: ${first.message}`,
      });
    }
    return errors;
  }
}
