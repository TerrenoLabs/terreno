import {APIError} from "@terreno/api";
import {DATASET_COLUMN_TYPES, type DATASET_GRAINS, type DatasetColumn} from "@terreno/blocks";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import {AIDataset} from "../models/aiDataset";
import type {AIDatasetCell, AIDatasetDocument} from "../types";

const DEFAULT_DATASET_MAX_ROWS = 50_000;
const DEFAULT_DATASET_TTL_DAYS = 0;
const COLUMN_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_COLUMNS = 12;
const PREVIEW_ROWS = 20;

export type DatasetGrain = (typeof DATASET_GRAINS)[number];

/** Handle returned by `registerAiDataset` for the tool result the model sees. */
export interface RegisteredDataset {
  columns: DatasetColumn[];
  datasetId: string;
  preview: AIDatasetCell[][];
  rowCount: number;
  stats: Record<string, {max: number; min: number}>;
}

interface DatasetConfig {
  datasetMaxRows: number;
  datasetTtlDays: number;
}

let datasetConfig: DatasetConfig = {
  datasetMaxRows: DEFAULT_DATASET_MAX_ROWS,
  datasetTtlDays: DEFAULT_DATASET_TTL_DAYS,
};

/** Row cap and retention used by `registerAiDataset`. Called from `addGptRoutes` when `uiBlocks` is on. */
export const configureAiDatasets = (
  options: {datasetMaxRows?: number; datasetTtlDays?: number} = {}
): void => {
  datasetConfig = {
    datasetMaxRows: options.datasetMaxRows ?? DEFAULT_DATASET_MAX_ROWS,
    datasetTtlDays: options.datasetTtlDays ?? DEFAULT_DATASET_TTL_DAYS,
  };
};

const columnType = (value: string): value is DatasetColumn["type"] =>
  (DATASET_COLUMN_TYPES as readonly string[]).includes(value);

const assertColumns = (columns: DatasetColumn[]): void => {
  if (columns.length < 1 || columns.length > MAX_COLUMNS) {
    throw new APIError({status: 400, title: "A dataset has between 1 and 12 columns"});
  }
  for (const column of columns) {
    if (!COLUMN_NAME.test(column.name) || !columnType(column.type)) {
      throw new APIError({status: 400, title: `Invalid column ${column.name}`});
    }
  }
};

const assertCell = (column: DatasetColumn, cell: AIDatasetCell): void => {
  if (cell === null) {
    return;
  }
  if (column.type === "number" && typeof cell === "number" && Number.isFinite(cell)) {
    return;
  }
  if (column.type === "string" && typeof cell === "string") {
    return;
  }
  if (
    column.type === "date" &&
    typeof cell === "string" &&
    DateTime.fromISO(cell, {zone: "utc"}).isValid
  ) {
    return;
  }
  throw new APIError({status: 400, title: `Column ${column.name} has a value of the wrong type`});
};

const assertRows = (columns: DatasetColumn[], rows: AIDatasetCell[][]): void => {
  if (rows.length > datasetConfig.datasetMaxRows) {
    throw new APIError({
      status: 413,
      title: `Dataset exceeds the row cap of ${datasetConfig.datasetMaxRows}`,
    });
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new APIError({status: 400, title: "Each row must have one cell per column"});
    }
    columns.forEach((column, index) => {
      assertCell(column, row[index]);
    });
  }
};

const numericStats = (
  columns: DatasetColumn[],
  rows: AIDatasetCell[][]
): Record<string, {max: number; min: number}> => {
  const stats: Record<string, {max: number; min: number}> = {};
  columns.forEach((column, index) => {
    if (column.type !== "number") {
      return;
    }
    const values = rows
      .map((row) => row[index])
      .filter((cell): cell is number => typeof cell === "number");
    if (values.length === 0) {
      return;
    }
    stats[column.name] = {max: Math.max(...values), min: Math.min(...values)};
  });
  return stats;
};

/**
 * Stores rows for a `ref` dataset. Only server tools call this. The model receives
 * `datasetId`, not a way to create one.
 */
export const registerAiDataset = async ({
  columns,
  historyId,
  rows,
  userId,
}: {
  columns: DatasetColumn[];
  historyId: mongoose.Types.ObjectId | string;
  rows: AIDatasetCell[][];
  userId: mongoose.Types.ObjectId | string;
}): Promise<RegisteredDataset> => {
  assertColumns(columns);
  assertRows(columns, rows);
  const created = await AIDataset.create({
    columns,
    historyId,
    rowCount: rows.length,
    rows,
    userId,
  });
  if (datasetConfig.datasetTtlDays > 0) {
    created.expiresAt = DateTime.fromJSDate(created.created)
      .plus({days: datasetConfig.datasetTtlDays})
      .toJSDate();
    await created.save();
  }
  return {
    columns,
    datasetId: created._id.toString(),
    preview: rows.slice(0, PREVIEW_ROWS),
    rowCount: rows.length,
    stats: numericStats(columns, rows),
  };
};

const bucketKey = (value: AIDatasetCell, grain: DatasetGrain): string => {
  if (typeof value !== "string") {
    return "";
  }
  const parsed = DateTime.fromISO(value, {zone: "utc"});
  if (!parsed.isValid) {
    return value;
  }
  return parsed.startOf(grain).toUTC().toISO() ?? value;
};

/**
 * Sums number columns into one row per date bucket. The first date column is the bucket.
 * @internal Test seam. Dataset reads call this before the response is built.
 */
export const bucketByGrain = (
  columns: DatasetColumn[],
  rows: AIDatasetCell[][],
  grain: DatasetGrain
): AIDatasetCell[][] => {
  const dateIndex = columns.findIndex((column) => column.type === "date");
  if (dateIndex < 0) {
    throw new APIError({status: 400, title: "grain requires a date column"});
  }
  const grouped = new Map<string, AIDatasetCell[]>();
  for (const row of rows) {
    const key = bucketKey(row[dateIndex], grain);
    const existing = grouped.get(key);
    if (!existing) {
      const next = [...row];
      next[dateIndex] = key;
      grouped.set(key, next);
      continue;
    }
    columns.forEach((column, index) => {
      if (column.type !== "number") {
        return;
      }
      const prior = existing[index];
      const cell = row[index];
      const priorNumber = typeof prior === "number" ? prior : 0;
      const cellNumber = typeof cell === "number" ? cell : 0;
      existing[index] = prior === null && cell === null ? null : priorNumber + cellNumber;
    });
  }
  return [...grouped.keys()].sort().map((key) => grouped.get(key) as AIDatasetCell[]);
};

/** Indexes chosen by largest-triangle-three-buckets. Always includes the first and last index. */
const lttbIndexes = (points: {x: number; y: number}[], threshold: number): number[] => {
  const count = points.length;
  if (threshold >= count) {
    return points.map((_, index) => index);
  }
  if (threshold <= 1) {
    return [0];
  }
  if (threshold === 2) {
    return [0, count - 1];
  }
  const sampled = [0];
  const bucketSize = (count - 2) / (threshold - 2);
  let selected = 0;
  for (let bucket = 0; bucket < threshold - 2; bucket++) {
    const avgStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const avgEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, count);
    let avgX = 0;
    let avgY = 0;
    const avgCount = Math.max(avgEnd - avgStart, 1);
    for (let index = avgStart; index < avgEnd; index++) {
      avgX += points[index].x;
      avgY += points[index].y;
    }
    avgX /= avgCount;
    avgY /= avgCount;

    const rangeStart = Math.floor(bucket * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, count - 1);
    let maxArea = -1;
    let nextIndex = rangeStart;
    const anchor = points[selected];
    for (let index = rangeStart; index < rangeEnd; index++) {
      const area = Math.abs(
        (anchor.x - avgX) * (points[index].y - anchor.y) -
          (anchor.x - points[index].x) * (avgY - anchor.y)
      );
      if (area > maxArea) {
        maxArea = area;
        nextIndex = index;
      }
    }
    sampled.push(nextIndex);
    selected = nextIndex;
  }
  sampled.push(count - 1);
  return sampled;
};

/**
 * Largest-triangle-three-buckets downsample. Keeps the first and last points and at most
 * `threshold` points total.
 * @internal Test seam. Row downsampling uses `lttbIndexes` in this module.
 */
export const lttb = (
  points: {x: number; y: number}[],
  threshold: number
): {x: number; y: number}[] => lttbIndexes(points, threshold).map((index) => ({...points[index]}));

/** Keeps at most `limit` rows. Line and area series use LTTB so the ends of the series stay. */
const downsampleRows = (
  columns: DatasetColumn[],
  rows: AIDatasetCell[][],
  limit: number
): AIDatasetCell[][] => {
  if (rows.length <= limit) {
    return rows;
  }
  const yIndex = columns.findIndex((column) => column.type === "number");
  if (yIndex < 0) {
    return rows.slice(0, limit);
  }
  const xIndex = columns.findIndex((column) => column.type === "date");
  const points = rows.map((row, index) => {
    const rawX = xIndex >= 0 ? row[xIndex] : index;
    const parsed =
      typeof rawX === "string" ? DateTime.fromISO(rawX, {zone: "utc"}).toMillis() : index;
    return {
      x: Number.isFinite(parsed) ? parsed : index,
      y: typeof row[yIndex] === "number" ? row[yIndex] : 0,
    };
  });
  return lttbIndexes(points, limit).map((index) => rows[index]);
};

export const readDatasetRows = (
  dataset: AIDatasetDocument,
  options: {grain?: DatasetGrain; limit: number; page?: number}
): {more: boolean; page: number; rowCount: number; rows: AIDatasetCell[][]} => {
  const source = options.grain
    ? bucketByGrain(dataset.columns, dataset.rows, options.grain)
    : dataset.rows;
  if (options.page !== undefined) {
    const start = (options.page - 1) * options.limit;
    return {
      more: start + options.limit < source.length,
      page: options.page,
      rowCount: source.length,
      rows: source.slice(start, start + options.limit),
    };
  }
  const rows = downsampleRows(dataset.columns, source, options.limit);
  return {more: false, page: 1, rowCount: source.length, rows};
};
