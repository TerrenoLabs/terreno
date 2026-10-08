import {BLOCK_ERROR_CODES, BLOCK_WARNING_CODES, type BlockError} from "./errors";
import {BLOCK_LIMITS} from "./limits";
import type {
  Block,
  BlocksDocument,
  Dataset,
  DatasetColumn,
  InlineDataset,
  StepperBlock,
} from "./schema";

export interface KnownDataset {
  columns: DatasetColumn[];
}

export interface LintBlocksOptions {
  /** When false or omitted, an `html` block fails with `HTML_DISABLED`. */
  allowHtml?: boolean;
  hostActions?: readonly string[];
  /** Hostnames allowed on `https` image `src` values. Empty means no https images. */
  imageHosts?: readonly string[];
  knownDatasets?: Record<string, KnownDataset>;
}

const issue = ({code, fix, message, path}: BlockError): BlockError => ({code, fix, message, path});

const imageSourceIssue = (
  src: string,
  hosts: readonly string[] | undefined,
  path: string
): BlockError | undefined => {
  if (src.startsWith("file:") && src.slice("file:".length).trim().length > 0) {
    return undefined;
  }
  if (/^data:image\//i.test(src)) {
    return undefined;
  }
  let hostname = "";
  try {
    const url = new URL(src);
    if (url.protocol === "https:") {
      hostname = url.hostname.toLowerCase();
    }
  } catch {
    hostname = "";
  }
  const allowed = (hosts ?? []).some((host) => host.toLowerCase() === hostname);
  if (hostname !== "" && allowed) {
    return undefined;
  }
  return issue({
    code: "IMAGE_HOST_NOT_ALLOWED",
    fix: "Use a data:image URL, a file: ref, or an https URL whose host is in uiBlocks.imageHosts.",
    message: BLOCK_ERROR_CODES.IMAGE_HOST_NOT_ALLOWED,
    path: `${path}.src`,
  });
};

/** The element ids a stepper's − and + buttons use in callback events. */
export const stepperElementIds = (stepperId: string): {decrease: string; increase: string} => ({
  decrease: `${stepperId}_decrease`,
  increase: `${stepperId}_increase`,
});

const unknownHostActionIssue = (
  name: string,
  hostActions: readonly string[] | undefined,
  path: string
): BlockError | undefined => {
  if (hostActions === undefined || hostActions.includes(name)) {
    return undefined;
  }
  return issue({
    code: "UNKNOWN_HOST_ACTION",
    fix: `Use one of: ${hostActions.join(", ") || "(none registered)"}.`,
    message: BLOCK_ERROR_CODES.UNKNOWN_HOST_ACTION,
    path,
  });
};

const stepperIssues = (
  block: StepperBlock,
  path: string,
  options: LintBlocksOptions | undefined
): BlockError[] => {
  const found: BlockError[] = [];
  if (block.min >= block.max) {
    found.push(
      issue({
        code: "OUT_OF_RANGE",
        fix: "Set max above min.",
        message: BLOCK_ERROR_CODES.OUT_OF_RANGE,
        path: `${path}.max`,
      })
    );
  } else if (block.value < block.min || block.value > block.max) {
    found.push(
      issue({
        code: "OUT_OF_RANGE",
        fix: `Set value between ${block.min} and ${block.max}.`,
        message: BLOCK_ERROR_CODES.OUT_OF_RANGE,
        path: `${path}.value`,
      })
    );
  }
  if (block.step !== undefined && block.step <= 0) {
    found.push(
      issue({
        code: "OUT_OF_RANGE",
        fix: "Set step above 0, or leave it out for 1.",
        message: BLOCK_ERROR_CODES.OUT_OF_RANGE,
        path: `${path}.step`,
      })
    );
  }
  const unknown = unknownHostActionIssue(
    block.callback.name,
    options?.hostActions,
    `${path}.callback.name`
  );
  if (unknown) {
    found.push(unknown);
  }
  return found;
};

const isInline = (dataset: Dataset): dataset is InlineDataset => dataset.source !== "ref";

const columnsFor = (
  dataset: Dataset,
  options: LintBlocksOptions | undefined
): DatasetColumn[] | undefined => {
  if (isInline(dataset)) {
    return dataset.columns;
  }
  return options?.knownDatasets?.[dataset.id]?.columns;
};

const cellMatches = (type: DatasetColumn["type"], value: unknown): boolean => {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string" && value.trim().length > 0;
};

const walk = (blocks: readonly Block[], prefix: string): {block: Block; path: string}[] => {
  const found: {block: Block; path: string}[] = [];
  blocks.forEach((block, index) => {
    const path = `${prefix}[${index}]`;
    found.push({block, path});
    if (block.type === "columns" || block.type === "card") {
      found.push(...walk(block.children, `${path}.children`));
    }
  });
  return found;
};

const renderedCount = (
  dataset: Dataset | undefined,
  points: number | undefined
): number | undefined => {
  if (points !== undefined) {
    return points;
  }
  if (dataset === undefined) {
    return undefined;
  }
  if (isInline(dataset)) {
    return dataset.rows.length;
  }
  return dataset.limit;
};

/**
 * Semantic checks for datasets, charts, and tables.
 * Structural schema errors are handled before this runs.
 */
export const lintDocument = (
  doc: BlocksDocument,
  options?: LintBlocksOptions
): {errors: BlockError[]; warnings: BlockError[]} => {
  const errors: BlockError[] = [];
  const warnings: BlockError[] = [];
  const datasets = doc.datasets ?? {};
  const names = Object.keys(datasets);
  if (names.length > BLOCK_LIMITS.maxDatasets) {
    errors.push(
      issue({
        code: "TOO_MANY",
        fix: `Keep ${BLOCK_LIMITS.maxDatasets} datasets or fewer.`,
        message: `The document has more than ${BLOCK_LIMITS.maxDatasets} datasets.`,
        path: "datasets",
      })
    );
  }

  for (const name of names) {
    const dataset = datasets[name];
    if (dataset === undefined || !isInline(dataset)) {
      if (
        dataset?.source === "ref" &&
        dataset.limit !== undefined &&
        dataset.limit > BLOCK_LIMITS.refLimitMax
      ) {
        errors.push(
          issue({
            code: "TOO_MANY_POINTS",
            fix: `Set grain to a coarser bucket, or set limit to ${BLOCK_LIMITS.refLimitMax} or less.`,
            message: BLOCK_ERROR_CODES.TOO_MANY_POINTS,
            path: `datasets.${name}.limit`,
          })
        );
      }
      continue;
    }
    if (dataset.columns.length > BLOCK_LIMITS.datasetColumnMax) {
      errors.push(
        issue({
          code: "DATASET_TOO_LARGE",
          fix: `Use ${BLOCK_LIMITS.datasetColumnMax} columns or fewer.`,
          message: BLOCK_ERROR_CODES.DATASET_TOO_LARGE,
          path: `datasets.${name}.columns`,
        })
      );
    }
    if (dataset.rows.length > BLOCK_LIMITS.datasetRowMax) {
      errors.push(
        issue({
          code: "DATASET_TOO_LARGE",
          fix: `Use ${BLOCK_LIMITS.datasetRowMax} rows or fewer, or return a ref dataset from a tool.`,
          message: BLOCK_ERROR_CODES.DATASET_TOO_LARGE,
          path: `datasets.${name}.rows`,
        })
      );
    }
    const seenColumns = new Set<string>();
    dataset.columns.forEach((column, index) => {
      if (seenColumns.has(column.name)) {
        errors.push(
          issue({
            code: "DUPLICATE_ID",
            fix: `Rename the duplicate column "${column.name}".`,
            message: BLOCK_ERROR_CODES.DUPLICATE_ID,
            path: `datasets.${name}.columns[${index}].name`,
          })
        );
      }
      seenColumns.add(column.name);
    });
    dataset.rows.forEach((row, rowIndex) => {
      if (row.length !== dataset.columns.length) {
        errors.push(
          issue({
            code: "ROW_ARITY_MISMATCH",
            fix: `Give the row ${dataset.columns.length} values, one per column.`,
            message: BLOCK_ERROR_CODES.ROW_ARITY_MISMATCH,
            path: `datasets.${name}.rows[${rowIndex}]`,
          })
        );
        return;
      }
      row.forEach((value, columnIndex) => {
        const column = dataset.columns[columnIndex];
        if (column === undefined || cellMatches(column.type, value)) {
          return;
        }
        errors.push(
          issue({
            code: "COLUMN_TYPE_MISMATCH",
            fix: `Make datasets.${name}.rows[${rowIndex}][${columnIndex}] a ${column.type}.`,
            message: BLOCK_ERROR_CODES.COLUMN_TYPE_MISMATCH,
            path: `datasets.${name}.rows[${rowIndex}][${columnIndex}]`,
          })
        );
      });
    });
  }

  const seenIds = new Set<string>();
  const selectableIds = new Set<string>();
  const reservedIds = new Set<string>();
  const walked = walk(doc.blocks, "blocks");
  for (const {block} of walked) {
    if ((block.type === "chart" || block.type === "table") && block.id !== undefined) {
      selectableIds.add(block.id);
    }
    if (block.type === "stepper") {
      const {decrease, increase} = stepperElementIds(block.id);
      reservedIds.add(decrease);
      reservedIds.add(increase);
    }
  }
  const idIssue = (id: string, path: string): BlockError | undefined => {
    if (!seenIds.has(id) && !reservedIds.has(id)) {
      return undefined;
    }
    return issue({
      code: "DUPLICATE_ID",
      fix: reservedIds.has(id)
        ? `Rename ${path}. A stepper uses <id>_decrease and <id>_increase for its buttons.`
        : `Give ${path} a unique id.`,
      message: BLOCK_ERROR_CODES.DUPLICATE_ID,
      path: `${path}.id`,
    });
  };
  for (const {block, path} of walked) {
    if (block.type === "html") {
      if (options?.allowHtml !== true) {
        errors.push(
          issue({
            code: "HTML_DISABLED",
            fix: "Turn on uiBlocks.html before sending an html block, or use a text block.",
            message: BLOCK_ERROR_CODES.HTML_DISABLED,
            path,
          })
        );
      }
      const bytes = new TextEncoder().encode(block.html).length;
      if (bytes > BLOCK_LIMITS.htmlMaxBytes) {
        errors.push(
          issue({
            code: "HTML_TOO_LARGE",
            fix: `Keep the html field at or under ${BLOCK_LIMITS.htmlMaxBytes} bytes.`,
            message: BLOCK_ERROR_CODES.HTML_TOO_LARGE,
            path: `${path}.html`,
          })
        );
      }
    }
    if (block.type === "image") {
      const imageIssue = imageSourceIssue(block.src, options?.imageHosts, path);
      if (imageIssue) {
        errors.push(imageIssue);
      }
    }
    if (block.id !== undefined) {
      const duplicate = idIssue(block.id, path);
      if (duplicate) {
        errors.push(duplicate);
      }
      seenIds.add(block.id);
    }
    if (block.type === "stepper") {
      errors.push(...stepperIssues(block, path, options));
    }
    if (block.type === "chart") {
      const hasPoints = block.points !== undefined;
      const hasData = block.data !== undefined || block.x !== undefined || block.y !== undefined;
      if (hasPoints && hasData) {
        errors.push(
          issue({
            code: "INVALID_TYPE",
            fix: "Use data, x, and y, or use points. Do not set both.",
            message: "A chart binds to a dataset or lists points.",
            path: `${path}.points`,
          })
        );
      } else if (
        !hasPoints &&
        (block.data === undefined || block.x === undefined || block.y === undefined)
      ) {
        errors.push(
          issue({
            code: "MISSING_REQUIRED",
            fix: "Set data, x, and y, or set points.",
            message: BLOCK_ERROR_CODES.MISSING_REQUIRED,
            path: `${path}.data`,
          })
        );
      }
      const dataset = block.data === undefined ? undefined : datasets[block.data];
      if (block.data !== undefined && dataset === undefined) {
        errors.push(
          issue({
            code: "DATASET_NOT_FOUND",
            fix: `Define datasets.${block.data}, or use a dataset name that exists.`,
            message: BLOCK_ERROR_CODES.DATASET_NOT_FOUND,
            path: `${path}.data`,
          })
        );
      }
      const columns = dataset === undefined ? undefined : columnsFor(dataset, options);
      if (
        dataset !== undefined &&
        columns !== undefined &&
        block.x !== undefined &&
        block.y !== undefined
      ) {
        const xColumn = columns.find((column) => column.name === block.x);
        const yColumn = columns.find((column) => column.name === block.y);
        if (xColumn === undefined) {
          errors.push(
            issue({
              code: "COLUMN_NOT_FOUND",
              fix: `Set x to a column of ${block.data}.`,
              message: BLOCK_ERROR_CODES.COLUMN_NOT_FOUND,
              path: `${path}.x`,
            })
          );
        } else if (xColumn.type === "number") {
          errors.push(
            issue({
              code: "COLUMN_TYPE_MISMATCH",
              fix: "Use a string or date column for x.",
              message: BLOCK_ERROR_CODES.COLUMN_TYPE_MISMATCH,
              path: `${path}.x`,
            })
          );
        }
        if (yColumn === undefined) {
          errors.push(
            issue({
              code: "COLUMN_NOT_FOUND",
              fix: `Set y to a column of ${block.data}.`,
              message: BLOCK_ERROR_CODES.COLUMN_NOT_FOUND,
              path: `${path}.y`,
            })
          );
        } else if (yColumn.type !== "number") {
          errors.push(
            issue({
              code: "COLUMN_TYPE_MISMATCH",
              fix: "Use a number column for y.",
              message: BLOCK_ERROR_CODES.COLUMN_TYPE_MISMATCH,
              path: `${path}.y`,
            })
          );
        }
      }
      const count = renderedCount(dataset, block.points?.length);
      if (block.kind === "bar" && count !== undefined && count > BLOCK_LIMITS.barCategoryWarning) {
        warnings.push(
          issue({
            code: "BAR_TOO_MANY_CATEGORIES",
            fix: "Group the categories, or use a line chart.",
            message: BLOCK_WARNING_CODES.BAR_TOO_MANY_CATEGORIES,
            path,
          })
        );
      }
      if (block.kind === "donut" && count !== undefined && count > BLOCK_LIMITS.donutSliceWarning) {
        warnings.push(
          issue({
            code: "DONUT_TOO_MANY_SLICES",
            fix: "Keep 8 slices or fewer.",
            message: BLOCK_WARNING_CODES.DONUT_TOO_MANY_SLICES,
            path,
          })
        );
      }
      if (block.kind === "line" && count === 1) {
        warnings.push(
          issue({
            code: "LINE_SINGLE_POINT",
            fix: "Add another point, or use a metric block.",
            message: BLOCK_WARNING_CODES.LINE_SINGLE_POINT,
            path,
          })
        );
      }
    }
    if (block.type === "actions") {
      block.elements.forEach((element, index) => {
        const elementPath = `${path}.elements[${index}]`;
        const duplicate = idIssue(element.id, elementPath);
        if (duplicate) {
          errors.push(duplicate);
        }
        seenIds.add(element.id);
        if (element.type === "segmented" && !selectableIds.has(element.target)) {
          errors.push(
            issue({
              code: "SELECT_TARGET_INVALID",
              fix: "Set target to the id of a chart or table in this document.",
              message: BLOCK_ERROR_CODES.SELECT_TARGET_INVALID,
              path: `${elementPath}.target`,
            })
          );
        }
        if (
          element.type === "button" &&
          element.action.kind === "select" &&
          !selectableIds.has(element.action.target)
        ) {
          errors.push(
            issue({
              code: "SELECT_TARGET_INVALID",
              fix: "Set target to the id of a chart or table in this document.",
              message: BLOCK_ERROR_CODES.SELECT_TARGET_INVALID,
              path: `${elementPath}.action.target`,
            })
          );
        }
        if (element.type === "button" && element.action.kind === "callback") {
          const unknown = unknownHostActionIssue(
            element.action.name,
            options?.hostActions,
            `${elementPath}.action.name`
          );
          if (unknown) {
            errors.push(unknown);
          }
        }
        if (element.type === "button" && element.action.kind === "open") {
          const hasRoute = element.action.route !== undefined;
          const hasUrl = element.action.url !== undefined;
          if (hasRoute === hasUrl) {
            errors.push(
              issue({
                code: "MISSING_REQUIRED",
                fix: "Set either url or route on an open action.",
                message: BLOCK_ERROR_CODES.MISSING_REQUIRED,
                path: `${elementPath}.action`,
              })
            );
          }
        }
      });
    }
    if (block.type === "table") {
      const dataset = datasets[block.data];
      if (dataset === undefined) {
        errors.push(
          issue({
            code: "DATASET_NOT_FOUND",
            fix: `Define datasets.${block.data}.`,
            message: BLOCK_ERROR_CODES.DATASET_NOT_FOUND,
            path: `${path}.data`,
          })
        );
        continue;
      }
      const columns = columnsFor(dataset, options);
      const listed = block.columns ?? columns?.map((column) => column.name);
      if (listed !== undefined && listed.length > BLOCK_LIMITS.datasetColumnMax) {
        errors.push(
          issue({
            code: "TABLE_TOO_WIDE",
            fix: `List ${BLOCK_LIMITS.datasetColumnMax} columns or fewer.`,
            message: BLOCK_ERROR_CODES.TABLE_TOO_WIDE,
            path: `${path}.columns`,
          })
        );
      }
      if (columns === undefined || block.columns === undefined) {
        continue;
      }
      for (const [index, columnName] of block.columns.entries()) {
        if (!columns.some((column) => column.name === columnName)) {
          errors.push(
            issue({
              code: "COLUMN_NOT_FOUND",
              fix: `Remove "${columnName}" or add it to the dataset.`,
              message: BLOCK_ERROR_CODES.COLUMN_NOT_FOUND,
              path: `${path}.columns[${index}]`,
            })
          );
        }
      }
    }
  }

  return {errors, warnings};
};
