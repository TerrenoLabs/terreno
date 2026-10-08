import type {Block, ChecklistBlock, Dataset, ListBlock, StepperBlock, TableBlock} from "./schema";

export interface BlockPlainTextOptions {
  /**
   * Current ticks by checklist item id. An entry overrides that item's `checked`; ids the
   * checklist does not have are ignored.
   */
  checked?: Record<string, boolean>;
  /** The document's datasets. A table copies only an inline dataset, so resolve refs first. */
  datasets?: Record<string, Dataset>;
}

const withUnit = (value: string, unit: string | undefined): string =>
  unit === undefined ? value : `${value} ${unit}`;

/** Matches the renderer: each amount is fixed to the item's `decimals`, so 2 at 1 is "2.0". */
const stepperText = (block: StepperBlock): string =>
  [
    `${block.label}: ${withUnit(String(block.value), block.unit)}`,
    ...(block.items ?? []).map(
      (item) => `${item.label}: ${withUnit(item.amount.toFixed(item.decimals ?? 0), item.unit)}`
    ),
  ].join("\n");

const checklistText = (
  block: ChecklistBlock,
  checked: Record<string, boolean> | undefined
): string =>
  block.items
    .map((item) => `${(checked?.[item.id] ?? item.checked) === true ? "[x]" : "[ ]"} ${item.text}`)
    .join("\n");

const listText = (block: ListBlock): string =>
  block.items
    .map((item) => (item.text === undefined ? `- ${item.title}` : `- ${item.title}: ${item.text}`))
    .join("\n");

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

const tableText = (block: TableBlock, datasets: Record<string, Dataset> | undefined): string => {
  const dataset = datasets?.[block.data];
  if (dataset === undefined || dataset.source === "ref") {
    return "";
  }
  const names = block.columns ?? dataset.columns.map((column) => column.name);
  const indexes = names.map((name) => dataset.columns.findIndex((column) => column.name === name));
  const rows = dataset.rows.map((row) =>
    indexes.map((index) => (index < 0 ? "" : cellText(row[index]))).join("\t")
  );
  // The header matches the table on screen, which shows underscores in column names as spaces.
  const header = names.map((name) => name.replaceAll("_", " ")).join("\t");
  return [header, ...rows].join("\n");
};

/**
 * The text a copy action writes to the clipboard for its target block. Pass the block as it is
 * shown now (a host override applied) and the current checklist ticks in `checked`. Blocks a
 * copy action cannot target return an empty string, as does a table whose dataset is missing or
 * an unresolved ref.
 */
export const blockPlainText = (block: Block, options: BlockPlainTextOptions = {}): string => {
  switch (block.type) {
    case "stepper":
      return stepperText(block);
    case "checklist":
      return checklistText(block, options.checked);
    case "list":
      return listText(block);
    case "table":
      return tableText(block, options.datasets);
    case "text":
      return block.markdown;
    default:
      return "";
  }
};
