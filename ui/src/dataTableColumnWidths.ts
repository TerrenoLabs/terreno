import {Platform} from "react-native";

import type {DataTableCellData, DataTableColumn} from "./Common";
import {textFontSizes} from "./textFontSizes";

// Layout values DataTable renders with. DataTable.tsx and TableTitle import these, so the width
// estimate below and the rendered table cannot drift apart.

/** Padding on every side of each header and body cell. */
export const DATA_TABLE_CELL_PADDING = 16;
/** Horizontal padding on each header and body cell (both sides). */
export const DATA_TABLE_CELL_HORIZONTAL_PADDING = DATA_TABLE_CELL_PADDING * 2;
/** Font size of the uppercase, bold column title in the header. */
export const DATA_TABLE_HEADER_FONT_SIZE = 10;
/** Diameter of the round sort button in a sortable column's header. */
export const DATA_TABLE_SORT_BUTTON_SIZE = 16;
/** Gap between the header title and the sort button. */
export const DATA_TABLE_SORT_BUTTON_MARGIN = 8;
/** Width of the fixed "more" column drawn when `moreContentComponent` is set. */
export const DATA_TABLE_MORE_COLUMN_WIDTH = 48;
/** Border around the table body. */
export const DATA_TABLE_BORDER_WIDTH = 1;

/** Narrowest an auto-sized column starts at, before any fill is added. */
export const DATA_TABLE_AUTO_MIN_COLUMN_WIDTH = 80;
/** Widest an auto-sized column starts at, before any fill is added. Longer text wraps or clips. */
export const DATA_TABLE_AUTO_MAX_COLUMN_WIDTH = 360;
/** Rows read per column when estimating content width. Spread evenly across the data. */
export const DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS = 50;
/** Content width assumed for a custom cell whose value is not a string or number. */
export const DATA_TABLE_AUTO_CUSTOM_CONTENT_WIDTH = 120;

const HEADER_SORT_ICON_WIDTH = DATA_TABLE_SORT_BUTTON_SIZE + DATA_TABLE_SORT_BUTTON_MARGIN;
// InfoModalIcon and DataTableColumnFilterWeb size themselves; these are their rendered widths.
const HEADER_INFO_ICON_WIDTH = 26;
const HEADER_FILTER_ICON_WIDTH = 40;
const BOOLEAN_ICON_WIDTH = 20;

// Font families registered by TerrenoFontProvider, as Text picks them for sm/md cells and
// TableTitle's bold header.
const HEADER_FONT_FAMILY = "text-bold";
const CELL_FONT_FAMILY = "text-regular";

// Average glyph width as a share of font size, for Nunito. Native has no synchronous text
// measurement, so it estimates; web measures with a canvas.
const REGULAR_CHAR_WIDTH_RATIO = 0.56;
const BOLD_UPPERCASE_CHAR_WIDTH_RATIO = 0.72;

export type DataTableTextSize = "sm" | "md" | "lg";

export interface MeasureDataTableTextArgs {
  text: string;
  fontSize: number;
  isHeader: boolean;
}

export type MeasureDataTableText = (args: MeasureDataTableTextArgs) => number;

export const estimateDataTableTextWidth: MeasureDataTableText = ({text, fontSize, isHeader}) => {
  const ratio = isHeader ? BOLD_UPPERCASE_CHAR_WIDTH_RATIO : REGULAR_CHAR_WIDTH_RATIO;
  return Math.ceil(text.length * fontSize * ratio);
};

interface CanvasTextContext {
  font: string;
  measureText: (text: string) => {width: number};
}

interface CanvasDocument {
  createElement?: (tag: string) => unknown;
}

export interface CreateDataTableTextMeasurerArgs {
  /** Document to create the measuring canvas from. Defaults to the global document. */
  getDocument?: () => CanvasDocument | undefined;
  /** Whether to measure with a canvas. Defaults to `Platform.OS === "web"`. */
  isWeb?: () => boolean;
}

const getGlobalDocument = (): CanvasDocument | undefined =>
  (globalThis as {document?: CanvasDocument}).document;

const isWebPlatform = (): boolean => Platform.OS === "web";

/**
 * Builds a measurer that uses one shared canvas on web (no layout or reflow) and estimates
 * everywhere else, or when no canvas is available.
 */
export const createDataTableTextMeasurer = ({
  getDocument = getGlobalDocument,
  isWeb = isWebPlatform,
}: CreateDataTableTextMeasurerArgs = {}): MeasureDataTableText => {
  let canvasContext: CanvasTextContext | null | undefined;

  const getCanvasContext = (): CanvasTextContext | null => {
    if (canvasContext !== undefined) {
      return canvasContext;
    }
    const doc = getDocument();
    if (!doc?.createElement) {
      canvasContext = null;
      return canvasContext;
    }
    try {
      const canvas = doc.createElement("canvas") as {getContext?: (kind: string) => unknown};
      canvasContext = (canvas.getContext?.("2d") as CanvasTextContext | null) ?? null;
    } catch {
      canvasContext = null;
    }
    return canvasContext;
  };

  return (args) => {
    const context = isWeb() ? getCanvasContext() : null;
    if (!context) {
      return estimateDataTableTextWidth(args);
    }
    const family = args.isHeader ? HEADER_FONT_FAMILY : CELL_FONT_FAMILY;
    const weight = args.isHeader ? 700 : 400;
    context.font = `${weight} ${args.fontSize}px ${family}, Nunito, sans-serif`;
    const measured = context.measureText(args.isHeader ? args.text.toUpperCase() : args.text).width;
    // Fall back if the canvas is a stub (jsdom returns 0).
    if (!measured && args.text.length > 0) {
      return estimateDataTableTextWidth(args);
    }
    return Math.ceil(measured);
  };
};

/** Default measurer: canvas on web, estimate on native. */
export const measureDataTableTextWidth: MeasureDataTableText = createDataTableTextMeasurer();

const sampleRowIndexes = (rowCount: number): number[] => {
  if (rowCount <= DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS) {
    return Array.from({length: rowCount}, (_, index) => index);
  }
  const stride = rowCount / DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS;
  return Array.from({length: DATA_TABLE_AUTO_WIDTH_SAMPLE_ROWS}, (_, index) =>
    Math.floor(index * stride)
  );
};

const cellText = (
  column: DataTableColumn,
  cell: DataTableCellData,
  formatDate: (value: unknown) => string
): string | undefined => {
  const {value} = cell;
  if (column.columnType === "date") {
    return formatDate(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
};

const clampWidth = (width: number): number =>
  Math.min(DATA_TABLE_AUTO_MAX_COLUMN_WIDTH, Math.max(DATA_TABLE_AUTO_MIN_COLUMN_WIDTH, width));

export interface GetDataTableNaturalWidthsArgs {
  columns: DataTableColumn[];
  data: DataTableCellData[][];
  defaultTextSize: DataTableTextSize;
  formatDate: (value: unknown) => string;
  /** Column types drawn by `customColumnComponentMap`; their content is not text we can measure. */
  customColumnTypes?: Set<string>;
  hasFilters?: boolean;
  measureText?: MeasureDataTableText;
}

/**
 * Width each column wants on its own: the wider of its header and its sampled content, clamped
 * to a sane range. Columns with an explicit `width` keep it. Runs only when columns or data change.
 */
export const getDataTableNaturalWidths = ({
  columns,
  data,
  defaultTextSize,
  formatDate,
  customColumnTypes,
  hasFilters = false,
  measureText = measureDataTableTextWidth,
}: GetDataTableNaturalWidthsArgs): number[] => {
  const rowIndexes = sampleRowIndexes(data.length);

  return columns.map((column, columnIndex) => {
    if (column.width !== undefined) {
      return column.width;
    }

    let headerWidth = column.title
      ? measureText({fontSize: DATA_TABLE_HEADER_FONT_SIZE, isHeader: true, text: column.title})
      : 0;
    if (column.sortable) {
      headerWidth += HEADER_SORT_ICON_WIDTH;
    }
    if (column.infoModalText) {
      headerWidth += HEADER_INFO_ICON_WIDTH;
    }
    if (column.filter && hasFilters && Platform.OS === "web") {
      headerWidth += HEADER_FILTER_ICON_WIDTH;
    }

    let contentWidth = 0;
    const isCustom = customColumnTypes?.has(column.columnType) ?? false;
    if (column.columnType === "boolean" && !isCustom) {
      contentWidth = BOOLEAN_ICON_WIDTH;
    } else {
      for (const rowIndex of rowIndexes) {
        const cell = data[rowIndex]?.[columnIndex];
        if (!cell) {
          continue;
        }
        const text = cellText(column, cell, formatDate);
        if (text === undefined) {
          if (isCustom) {
            contentWidth = Math.max(contentWidth, DATA_TABLE_AUTO_CUSTOM_CONTENT_WIDTH);
          }
          continue;
        }
        const fontSize = textFontSizes[cell.textSize ?? defaultTextSize].size;
        contentWidth = Math.max(contentWidth, measureText({fontSize, isHeader: false, text}));
        if (contentWidth >= DATA_TABLE_AUTO_MAX_COLUMN_WIDTH) {
          // Already at the cap; the rest of the sample cannot change the result.
          break;
        }
      }
    }

    return clampWidth(Math.max(headerWidth, contentWidth) + DATA_TABLE_CELL_HORIZONTAL_PADDING);
  });
};

export interface FitDataTableColumnWidthsArgs {
  columns: DataTableColumn[];
  naturalWidths: number[];
  /** Width the columns can fill. 0 (not measured yet) keeps the natural widths. */
  availableWidth: number;
}

/**
 * Grows auto-sized columns to fill the container, in proportion to their natural widths. When
 * the columns already overflow, they keep their natural widths and the table scrolls
 * horizontally. Columns with an explicit `width` never change.
 */
export const fitDataTableColumnWidths = ({
  columns,
  naturalWidths,
  availableWidth,
}: FitDataTableColumnWidthsArgs): number[] => {
  const autoIndexes = columns.flatMap((column, index) =>
    column.width === undefined ? [index] : []
  );
  const totalNatural = naturalWidths.reduce((sum, width) => sum + width, 0);
  const extra = Math.floor(availableWidth - totalNatural);
  if (autoIndexes.length === 0 || availableWidth <= 0 || extra <= 0) {
    return naturalWidths;
  }

  const autoNatural = autoIndexes.reduce((sum, index) => sum + naturalWidths[index], 0);
  const widths = [...naturalWidths];
  let assigned = 0;
  for (const index of autoIndexes) {
    const share = Math.floor((extra * naturalWidths[index]) / autoNatural);
    widths[index] += share;
    assigned += share;
  }
  // Rounding leftovers go to the last auto column so the row is exactly the container width.
  widths[autoIndexes[autoIndexes.length - 1]] += extra - assigned;
  return widths;
};
