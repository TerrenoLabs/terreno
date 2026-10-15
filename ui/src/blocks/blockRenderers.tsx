import {
  type Block,
  type BlockAction,
  type ButtonElement,
  blockPlainText,
  type ChecklistBlock,
  type ChecklistItem,
  type CopyAction,
  checklistElementId,
  type Dataset,
  type DatasetColumn,
  type GalleryBlock,
  type GalleryImage,
  type InlineDataset,
  type ListBlock,
  type ListItem,
  type StepperBlock,
  stepperElementIds,
  type TableBlock,
} from "@terreno/blocks";
import * as Clipboard from "expo-clipboard";
import type React from "react";
import {useCallback, useEffect, useRef, useState} from "react";

import {Accordion} from "../Accordion";
import {AreaChart} from "../AreaChart";
import {Badge} from "../Badge";
import {Banner} from "../Banner";
import {BarChart} from "../BarChart";
import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {CheckBox} from "../CheckBox";
import {type DataTableColumn, getSpacing, type LayoutChangeEvent} from "../Common";
import {DataTable} from "../DataTable";
import {DonutChart} from "../DonutChart";
import {Heading} from "../Heading";
import {HtmlFrame} from "../HtmlFrame";
import {IconButton} from "../IconButton";
import {Image} from "../Image";
import {LineChart} from "../LineChart";
import {MarkdownView} from "../MarkdownView";
import {SectionDivider} from "../SectionDivider";
import {SegmentedControl} from "../SegmentedControl";
import {Text} from "../Text";
import {chartHeight, chartPoints, datasetToPoints} from "./datasetToPoints";
import {fileRefId} from "./useResolvedImages";

export interface BlockRenderContext {
  allowHtml?: boolean;
  /** The document's top-level blocks, where a copy action looks up its `target`. */
  blocks?: readonly Block[];
  hostActions?: readonly string[];
  streaming?: boolean;
  loadingIds: ReadonlySet<string>;
  onAction?: (event: {action: BlockAction; blockId: string; elementId: string}) => void;
  overrides?: Record<string, Block>;
  pendingElementIds?: ReadonlySet<string>;
  resolved: Record<string, InlineDataset | undefined>;
  /** URLs for `file:` image ids. An unset id is not passed to `Image`. */
  resolvedImages?: Record<string, string | undefined>;
  /** Dataset name currently bound on a chart or table id, before any local selection. */
  boundData?: Record<string, string>;
  /** Local ticks by checklist id, then item id, for checklists that tick on the device. */
  checklistTicks?: Record<string, Record<string, boolean>>;
  setChecklistTick?: (target: {checked: boolean; checklistId: string; itemId: string}) => void;
  selections: Record<string, string>;
  setSelection: (target: string, data: string) => void;
}

const EMPTY_CONTEXT: BlockRenderContext = {
  loadingIds: new Set(),
  resolved: {},
  selections: {},
  setSelection: () => {},
};

const trendMark = {
  down: "▼",
  flat: "–",
  up: "▲",
} as const;

const renderChildren = (
  children: readonly Block[],
  path: string,
  context: BlockRenderContext
): React.ReactElement[] =>
  children.map((child, index) => renderBlock(child, `${path}-${index}`, context));

const chartFor = {
  area: AreaChart,
  bar: BarChart,
  donut: DonutChart,
  line: LineChart,
} as const;

/** Drops float noise such as 0.30000000000000004 from value ± step. */
const stepValue = (value: number, delta: number): number => Number((value + delta).toFixed(10));

const formatAmount = ({
  amount,
  decimals,
  unit,
}: {
  amount: number;
  decimals?: number;
  unit?: string;
}): string => {
  const formatted = amount.toFixed(decimals ?? 0);
  return unit ? `${formatted} ${unit}` : formatted;
};

const renderStepper = (
  block: StepperBlock,
  path: string,
  context: BlockRenderContext
): React.ReactElement => {
  const ids = stepperElementIds(block.id);
  const step = block.step ?? 1;
  const isPending =
    context.pendingElementIds?.has(ids.decrease) === true ||
    context.pendingElementIds?.has(ids.increase) === true;
  const isUnregistered =
    context.hostActions !== undefined && !context.hostActions.includes(block.callback.name);
  const isLocked = isPending || isUnregistered;
  const send = (elementId: string, value: number): void => {
    context.onAction?.({
      action: {
        kind: "callback",
        name: block.callback.name,
        payload: {...(block.callback.payload ?? {}), value},
      },
      blockId: block.id,
      elementId,
    });
  };
  // A button that would step past a bound is off, since the server rejects a value outside it.
  const decreaseDisabled = isLocked || stepValue(block.value, -step) < block.min;
  const increaseDisabled = isLocked || stepValue(block.value, step) > block.max;
  return (
    <Box gap={3} key={path} testID={path}>
      <Text color="secondaryLight" size="sm">
        {block.label}
      </Text>
      <Box alignItems="center" direction="row" gap={4}>
        <IconButton
          accessibilityLabel={`Decrease ${block.label}`}
          disabled={decreaseDisabled}
          iconName="minus"
          onClick={() => {
            if (decreaseDisabled) {
              return;
            }
            send(ids.decrease, stepValue(block.value, -step));
          }}
          testID={`${path}-${ids.decrease}`}
          variant="secondary"
        />
        <Box alignItems="center">
          <Text bold size="xl" testID={`${path}-value`}>
            {String(block.value)}
          </Text>
          {block.unit ? (
            <Text color="secondaryLight" size="sm">
              {block.unit}
            </Text>
          ) : null}
        </Box>
        <IconButton
          accessibilityLabel={`Increase ${block.label}`}
          disabled={increaseDisabled}
          iconName="plus"
          onClick={() => {
            if (increaseDisabled) {
              return;
            }
            send(ids.increase, stepValue(block.value, step));
          }}
          testID={`${path}-${ids.increase}`}
          variant="secondary"
        />
      </Box>
      {block.itemsTitle ? <Heading size="sm">{block.itemsTitle}</Heading> : null}
      {block.items && block.items.length > 0 ? (
        <Box gap={1} testID={`${path}-items`}>
          {block.items.map((item, index) => (
            <Box direction="row" gap={2} justifyContent="between" key={`${path}-item-${index}`}>
              <Text>{item.label}</Text>
              <Text bold>{formatAmount(item)}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {block.note ? (
        <Text color="secondaryLight" size="sm">
          {block.note}
        </Text>
      ) : null}
    </Box>
  );
};

/** One row: the tick, then the bold text, the small muted meta (such as a time), and the detail. */
const ChecklistRowContent: React.FC<{
  isChecked: boolean;
  item: ChecklistItem;
  itemPath: string;
}> = ({isChecked, item, itemPath}) => (
  <>
    <Box paddingY={1}>
      <CheckBox selected={isChecked} testID={`${itemPath}-checkbox`} />
    </Box>
    <Box flex="grow" gap={1}>
      <Text bold testID={`${itemPath}-text`}>
        {item.text}
      </Text>
      {item.meta ? (
        <Text color="secondaryLight" size="sm" testID={`${itemPath}-meta`}>
          {item.meta}
        </Text>
      ) : null}
      {item.detail ? (
        <Text color="secondaryLight" size="sm" testID={`${itemPath}-detail`}>
          {item.detail}
        </Text>
      ) : null}
    </Box>
  </>
);

/**
 * Ticks go to the host when the checklist names a callback, the host listens with `onAction`,
 * and `hostActions` is omitted (as for the stepper) or lists that callback. Otherwise they stay
 * on the device.
 */
const isChecklistCallbackMode = (block: ChecklistBlock, context: BlockRenderContext): boolean =>
  block.callback !== undefined &&
  context.onAction !== undefined &&
  (context.hostActions === undefined || context.hostActions.includes(block.callback.name));

const renderChecklist = (
  block: ChecklistBlock,
  path: string,
  context: BlockRenderContext
): React.ReactElement => {
  const isCallbackMode = isChecklistCallbackMode(block, context);
  // One pending tick locks every item, so a second tick cannot send a `state` that misses it.
  const isAnyPending = block.items.some(
    (item) => context.pendingElementIds?.has(checklistElementId(block.id, item.id)) === true
  );
  const localTicks = isCallbackMode ? undefined : context.checklistTicks?.[block.id];
  const state: Record<string, boolean> = {};
  for (const item of block.items) {
    state[item.id] = localTicks?.[item.id] ?? item.checked === true;
  }
  const checkedCount = Object.values(state).filter(Boolean).length;
  const toggle = (item: ChecklistItem, elementId: string): void => {
    const checked = !state[item.id];
    if (!isCallbackMode || block.callback === undefined) {
      context.setChecklistTick?.({checked, checklistId: block.id, itemId: item.id});
      return;
    }
    context.onAction?.({
      action: {
        kind: "callback",
        name: block.callback.name,
        payload: {
          ...(block.callback.payload ?? {}),
          checked,
          itemId: item.id,
          state: {...state, [item.id]: checked},
        },
      },
      blockId: block.id,
      elementId,
    });
  };
  return (
    <Box gap={3} key={path} testID={path}>
      <Box alignItems="center" direction="row" gap={2} justifyContent="between">
        <Box flex="shrink">{block.title ? <Heading size="sm">{block.title}</Heading> : null}</Box>
        <Text color="secondaryLight" size="sm" testID={`${path}-counter`}>
          {`${checkedCount} of ${block.items.length}`}
        </Text>
      </Box>
      <Box gap={2}>
        {block.items.map((item) => {
          const elementId = checklistElementId(block.id, item.id);
          const itemPath = `${path}-${elementId}`;
          const isChecked = state[item.id] === true;
          const isLocked = isCallbackMode
            ? isAnyPending
            : context.pendingElementIds?.has(elementId) === true;
          return (
            <Box key={itemPath} testID={itemPath}>
              <Box
                accessibilityHint={
                  isChecked ? "Marks this item as not done" : "Marks this item as done"
                }
                accessibilityLabel={item.text}
                accessibilityRole="checkbox"
                accessibilityState={{checked: isChecked, disabled: isLocked}}
                direction="row"
                gap={3}
                onClick={() => {
                  if (isLocked) {
                    return;
                  }
                  toggle(item, elementId);
                }}
                testID={`${itemPath}-row`}
                {...(isLocked ? {dangerouslySetInlineStyle: {__style: {opacity: 0.5}}} : {})}
              >
                <ChecklistRowContent isChecked={isChecked} item={item} itemPath={itemPath} />
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

/** Column width before the first layout pass reports the container width. */
const TABLE_DEFAULT_COLUMN_WIDTH = 120;
/** Narrowest column; past this the table scrolls sideways. */
const TABLE_MIN_COLUMN_WIDTH = 96;

const DATASET_TO_COLUMN_TYPE: Record<DatasetColumn["type"], DataTableColumn["columnType"]> = {
  date: "date",
  number: "number",
  string: "text",
};

const tableColumnWidth = ({
  columnCount,
  containerWidth,
}: {
  columnCount: number;
  containerWidth?: number;
}): number => {
  if (containerWidth === undefined || columnCount === 0) {
    return TABLE_DEFAULT_COLUMN_WIDTH;
  }
  return Math.max(TABLE_MIN_COLUMN_WIDTH, Math.floor(containerWidth / columnCount));
};

/** DataTable's default header and row height. */
const TABLE_ROW_HEIGHT = 54;
/** Rows a table block shows before its body scrolls. */
const TABLE_MAX_VISIBLE_ROWS = 10;
/** Top and bottom border of the DataTable frame. */
const TABLE_BORDER_HEIGHT = 2;

/**
 * DataTable fills its parent's height, so the block gives it a frame sized to the header plus its
 * rows; otherwise the table also counts the title and spills over the next block.
 */
const tableFrameHeight = (rowCount: number): number =>
  (Math.min(rowCount, TABLE_MAX_VISIBLE_ROWS) + 1) * TABLE_ROW_HEIGHT + TABLE_BORDER_HEIGHT;

const TableBlockView: React.FC<{
  block: TableBlock;
  context: BlockRenderContext;
  path: string;
}> = ({block, context, path}) => {
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const {width} = event.nativeEvent.layout;
    setContainerWidth((previous) => (previous === width ? previous : width));
  }, []);
  const dataName =
    (block.id !== undefined ? context.selections[block.id] : undefined) ?? block.data;
  const dataset = dataName === undefined ? undefined : context.resolved[dataName];
  const names = block.columns ?? dataset?.columns.map((column) => column.name) ?? [];
  const indexes = names.map(
    (name) => dataset?.columns.findIndex((column) => column.name === name) ?? -1
  );
  const width = tableColumnWidth({columnCount: names.length, containerWidth});
  const columns: DataTableColumn[] = names.map((name, position) => {
    const datasetType = dataset?.columns[indexes[position] ?? -1]?.type;
    return {
      columnType: datasetType === undefined ? "text" : DATASET_TO_COLUMN_TYPE[datasetType],
      title: name.replaceAll("_", " "),
      width,
    };
  });
  return (
    <Box gap={2} onLayout={handleLayout} testID={path}>
      {block.title ? <Heading size="sm">{block.title}</Heading> : null}
      <Box height={tableFrameHeight(dataset?.rows.length ?? 0)} testID={`${path}-table-frame`}>
        <DataTable
          columns={columns}
          data={(dataset?.rows ?? []).map((row) =>
            indexes.map((index) => ({value: index < 0 ? "" : row[index]}))
          )}
          testID={`${path}-table`}
        />
      </Box>
    </Box>
  );
};

/** Most tiles in one gallery row; more images wrap into further rows. */
const GALLERY_COLUMNS = 3;
/** Narrowest tile, and the tile width before the first layout pass; past this the row scrolls sideways. */
const GALLERY_MIN_TILE_WIDTH = 160;
/** Box `gap` step between tiles. */
const GALLERY_GAP = 2;

interface GalleryLayout {
  isScrolling: boolean;
  rows: GalleryImage[][];
  tileHeight: number;
  tileWidth: number;
}

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    rows.push(items.slice(start, start + size));
  }
  return rows;
};

const galleryLayout = ({
  containerWidth,
  images,
}: {
  containerWidth?: number;
  images: readonly GalleryImage[];
}): GalleryLayout => {
  const columns = Math.min(GALLERY_COLUMNS, images.length);
  const gap = getSpacing(GALLERY_GAP);
  const fitWidth =
    containerWidth === undefined || columns === 0
      ? GALLERY_MIN_TILE_WIDTH
      : Math.floor((containerWidth - gap * (columns - 1)) / columns);
  const isScrolling = fitWidth < GALLERY_MIN_TILE_WIDTH;
  const tileWidth = isScrolling ? GALLERY_MIN_TILE_WIDTH : fitWidth;
  return {
    isScrolling,
    rows: isScrolling ? [[...images]] : chunk(images, GALLERY_COLUMNS),
    tileHeight: Math.round((tileWidth * 3) / 4),
    tileWidth,
  };
};

const GalleryTile: React.FC<{
  height: number;
  image: GalleryImage;
  testID: string;
  url?: string;
  width: number;
}> = ({height, image, testID, url, width}) => (
  <Box gap={1} testID={testID} width={width}>
    {url ? (
      <Box overflow="hidden" rounding="md" testID={`${testID}-image`}>
        <Image
          alt={image.alt}
          color="transparent"
          fit="cover"
          naturalWidth={width}
          src={url}
          style={{height, width}}
        />
      </Box>
    ) : (
      <Box
        accessibilityLabel={image.alt}
        alignItems="center"
        color="neutralLight"
        height={height}
        justifyContent="center"
        padding={2}
        rounding="md"
        testID={`${testID}-placeholder`}
      >
        <Text align="center" color="secondaryLight" size="sm">
          {image.alt}
        </Text>
      </Box>
    )}
    {image.caption ? (
      <Text color="secondaryLight" size="sm" testID={`${testID}-caption`}>
        {image.caption}
      </Text>
    ) : null}
  </Box>
);

/**
 * Up to three tiles share one row; more wrap into a three-column grid. When the measured width
 * would make a tile narrower than GALLERY_MIN_TILE_WIDTH, every tile sits in one row that
 * scrolls sideways instead.
 */
const GalleryBlockView: React.FC<{
  block: GalleryBlock;
  context: BlockRenderContext;
  path: string;
}> = ({block, context, path}) => {
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const {width} = event.nativeEvent.layout;
    setContainerWidth((previous) => (previous === width ? previous : width));
  }, []);
  const layout = galleryLayout({containerWidth, images: block.images});
  const indexOf = new Map(block.images.map((image, index) => [image, index]));
  const renderTile = (image: GalleryImage): React.ReactElement => {
    const index = indexOf.get(image) ?? 0;
    const fileId = fileRefId(image.src);
    const url = fileId === undefined ? image.src : context.resolvedImages?.[fileId];
    return (
      <GalleryTile
        height={layout.tileHeight}
        image={image}
        key={`${path}-image-${index}`}
        testID={`${path}-image-${index}`}
        url={url}
        width={layout.tileWidth}
      />
    );
  };
  return (
    <Box onLayout={handleLayout} testID={path}>
      {layout.isScrolling ? (
        <Box direction="row" gap={GALLERY_GAP} overflow="scrollX" scroll testID={`${path}-scroll`}>
          {block.images.map(renderTile)}
        </Box>
      ) : (
        <Box gap={GALLERY_GAP}>
          {layout.rows.map((row, rowIndex) => (
            <Box
              direction="row"
              gap={GALLERY_GAP}
              key={`${path}-row-${rowIndex}`}
              testID={`${path}-row-${rowIndex}`}
            >
              {row.map(renderTile)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/** Fixed thumbnail width; also the gutter an imageless item keeps when another item has a thumbnail. */
const LIST_THUMBNAIL_WIDTH = 112;
/** 3:4 portrait: 112 * 4 / 3 = 149.3, rounded. */
const LIST_THUMBNAIL_HEIGHT = Math.round((LIST_THUMBNAIL_WIDTH * 4) / 3);

const ListThumbnail: React.FC<{
  image: NonNullable<ListItem["image"]>;
  testID: string;
  url?: string;
}> = ({image, testID, url}) => {
  if (!url) {
    return (
      <Box
        accessibilityLabel={image.alt}
        alignItems="center"
        color="neutralLight"
        height={LIST_THUMBNAIL_HEIGHT}
        justifyContent="center"
        padding={2}
        rounding="md"
        testID={`${testID}-placeholder`}
        width={LIST_THUMBNAIL_WIDTH}
      >
        <Text align="center" color="secondaryLight" size="sm">
          {image.alt}
        </Text>
      </Box>
    );
  }
  return (
    <Box overflow="hidden" rounding="md" testID={`${testID}-image`}>
      <Image
        alt={image.alt}
        color="transparent"
        fit="cover"
        naturalWidth={LIST_THUMBNAIL_WIDTH}
        src={url}
        style={{height: LIST_THUMBNAIL_HEIGHT, width: LIST_THUMBNAIL_WIDTH}}
      />
    </Box>
  );
};

/**
 * One row per item: a 3:4 thumbnail on the left, then the small muted meta, the bold title,
 * and the muted plain text. When any item has a thumbnail, an item without one keeps an empty
 * gutter of the same width so every title starts at the same x.
 */
const renderList = (
  block: ListBlock,
  path: string,
  context: BlockRenderContext
): React.ReactElement => {
  const hasThumbnails = block.items.some((item) => item.image !== undefined);
  return (
    <Box gap={3} key={path} testID={path}>
      {block.items.map((item, index) => {
        const itemPath = `${path}-item-${index}`;
        const fileId = item.image === undefined ? undefined : fileRefId(item.image.src);
        const url = fileId === undefined ? item.image?.src : context.resolvedImages?.[fileId];
        return (
          <Box direction="row" gap={3} key={itemPath} testID={itemPath}>
            {item.image !== undefined ? (
              <ListThumbnail image={item.image} testID={itemPath} url={url} />
            ) : hasThumbnails ? (
              <Box testID={`${itemPath}-gutter`} width={LIST_THUMBNAIL_WIDTH} />
            ) : null}
            <Box flex="grow" gap={1} testID={`${itemPath}-body`}>
              {item.meta ? (
                <Text color="secondaryLight" size="sm" testID={`${itemPath}-meta`}>
                  {item.meta}
                </Text>
              ) : null}
              <Text bold testID={`${itemPath}-title`}>
                {item.title}
              </Text>
              {item.text ? (
                <Text color="secondaryLight" testID={`${itemPath}-text`}>
                  {item.text}
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

/** How long "Copied" or "Couldn't copy" stays next to a copy button. */
const COPY_STATUS_MS = 2000;

const COPY_STATUS_TEXT = {
  copied: "Copied",
  failed: "Couldn't copy",
} as const;

/** Finds a block by id as it is shown now, with any override applied. */
const findShownBlock = (
  blocks: readonly Block[],
  id: string,
  overrides: Record<string, Block> | undefined
): Block | undefined => {
  for (const original of blocks) {
    const shown =
      original.id !== undefined && overrides?.[original.id] !== undefined
        ? overrides[original.id]
        : original;
    if (original.id === id || shown.id === id) {
      return shown;
    }
    if (shown.type === "columns" || shown.type === "card") {
      const found = findShownBlock(shown.children, id, overrides);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
};

/**
 * The text a copy action writes: its literal `text`, or its target block as shown now (override,
 * local checklist ticks, and the selected, resolved table dataset applied).
 */
const copyActionText = (action: CopyAction, context: BlockRenderContext): string => {
  if (action.text !== undefined) {
    return action.text;
  }
  if (action.target === undefined) {
    return "";
  }
  const block = findShownBlock(context.blocks ?? [], action.target, context.overrides);
  if (block === undefined) {
    return "";
  }
  if (block.type === "checklist") {
    const checked = isChecklistCallbackMode(block, context)
      ? undefined
      : context.checklistTicks?.[block.id];
    return blockPlainText(block, {checked});
  }
  if (block.type === "table") {
    const dataName =
      (block.id !== undefined ? context.selections[block.id] : undefined) ?? block.data;
    const dataset = context.resolved[dataName];
    const datasets: Record<string, Dataset> = dataset === undefined ? {} : {[dataName]: dataset};
    return blockPlainText({...block, data: dataName}, {datasets});
  }
  return blockPlainText(block);
};

type CopyStatus = keyof typeof COPY_STATUS_TEXT;

/** Writes the text and reports the outcome; empty text counts as a failed copy. */
const writeClipboard = async (text: string): Promise<CopyStatus> => {
  if (text === "") {
    console.warn("Failed to copy block text: the copy target has no text yet");
    return "failed";
  }
  try {
    await Clipboard.setStringAsync(text);
    return "copied";
  } catch (error) {
    console.warn("Failed to copy block text", error);
    return "failed";
  }
};

/**
 * Copies on the device and never calls `onAction`. The status sits in a polite live region that
 * stays mounted, so screen readers announce "Copied" when the text appears.
 */
const CopyButton: React.FC<{
  action: CopyAction;
  context: BlockRenderContext;
  testID: string;
  text: string;
  variant: ButtonElement["variant"];
}> = ({action, context, testID, text, variant}) => {
  // An object, so a repeat copy with the same status still restarts the clear timer.
  const [feedback, setFeedback] = useState<{status: CopyStatus} | undefined>(undefined);

  // Clears the status 2 s after each copy; a new copy or unmounting cancels the pending clear.
  useEffect(() => {
    if (feedback === undefined) {
      return;
    }
    const timer = setTimeout(() => setFeedback(undefined), COPY_STATUS_MS);
    return (): void => clearTimeout(timer);
  }, [feedback]);

  // BlocksView rebuilds the context every render, so the press reads the latest one from a ref
  // and the callback keeps one identity.
  const latest = useRef({action, context});
  latest.current = {action, context};

  const handleCopy = useCallback(async (): Promise<void> => {
    const status = await writeClipboard(
      copyActionText(latest.current.action, latest.current.context)
    );
    setFeedback({status});
  }, []);

  return (
    <Box alignItems="center" direction="row" gap={2}>
      <Button onClick={handleCopy} testID={testID} text={text} variant={variant ?? "primary"} />
      <Box accessibilityLiveRegion="polite" testID={`${testID}-status`}>
        {feedback ? (
          <Text
            color={feedback.status === "failed" ? "error" : "secondaryLight"}
            size="sm"
            testID={`${testID}-status-text`}
          >
            {COPY_STATUS_TEXT[feedback.status]}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
};

/** Renders one catalog block with @terreno/ui components. */
export const renderBlock = (
  block: Block,
  path: string,
  context: BlockRenderContext = EMPTY_CONTEXT,
  allowOverride = true
): React.ReactElement => {
  if (allowOverride && block.id !== undefined && context.overrides?.[block.id] !== undefined) {
    return renderBlock(context.overrides[block.id], path, context, false);
  }
  switch (block.type) {
    case "heading":
      return (
        <Heading key={path} size={block.size} testID={path}>
          {block.text}
        </Heading>
      );
    case "text":
      return (
        <Box key={path} testID={path}>
          <MarkdownView>{block.markdown}</MarkdownView>
        </Box>
      );
    case "metric":
      return (
        <Card key={path} testID={path}>
          <Text size="sm">{block.label}</Text>
          <Heading>{block.value}</Heading>
          {block.delta || block.trend ? (
            <Text>{`${block.trend ? `${trendMark[block.trend]} ` : ""}${block.delta ?? ""}`}</Text>
          ) : null}
          {block.helper ? (
            <Text color="secondaryLight" size="sm">
              {block.helper}
            </Text>
          ) : null}
        </Card>
      );
    case "badge":
      return <Badge key={path} status={block.status ?? "info"} testID={path} value={block.text} />;
    case "html":
      if (context.streaming || context.allowHtml !== true) {
        return (
          <Card key={path} testID={path}>
            <Text size="sm">Agent-generated preview</Text>
            <Text>
              {context.streaming
                ? "The preview appears when this reply finishes."
                : "HTML preview is turned off."}
            </Text>
          </Card>
        );
      }
      return (
        <Card key={path} testID={path}>
          <Text size="sm">Agent-generated preview</Text>
          {block.title ? <Heading size="sm">{block.title}</Heading> : null}
          <HtmlFrame height={block.height} html={block.html} title={block.title} />
        </Card>
      );
    case "callout":
      return (
        <Box key={path} testID={path}>
          <Banner dismissible={false} status={block.status ?? "info"} text={block.text} />
        </Box>
      );
    case "image": {
      const fileId = fileRefId(block.src);
      const src = fileId === undefined ? block.src : context.resolvedImages?.[fileId];
      return (
        <Box key={path} testID={path}>
          {src ? <Image alt={block.alt} color="transparent" naturalWidth={320} src={src} /> : null}
          <Text size="sm">{block.alt}</Text>
        </Box>
      );
    }
    case "details":
      return (
        <Accordion isCollapsed={false} key={path} title={block.title}>
          <Text>{block.text}</Text>
        </Accordion>
      );
    case "divider":
      return (
        <Box key={path} testID={path}>
          <SectionDivider />
        </Box>
      );
    case "context":
      return (
        <Text color="secondaryLight" key={path} size="sm" testID={path}>
          {block.text}
        </Text>
      );
    case "columns":
      return (
        <Box direction="column" gap={3} key={path} mdDirection="row" testID={path}>
          {renderChildren(block.children, path, context)}
        </Box>
      );
    case "card":
      return (
        <Card key={path} testID={path}>
          {block.eyebrow ? (
            <Text color="secondaryLight" size="sm" testID={`${path}-eyebrow`}>
              {block.eyebrow}
            </Text>
          ) : null}
          {block.title ? <Heading size="sm">{block.title}</Heading> : null}
          {renderChildren(block.children, path, context)}
        </Card>
      );
    case "chart": {
      const Chart = chartFor[block.kind];
      const dataName =
        (block.id !== undefined ? context.selections[block.id] : undefined) ?? block.data;
      const dataset = dataName === undefined ? undefined : context.resolved[dataName];
      const points =
        block.points !== undefined
          ? chartPoints(block.points)
          : dataset !== undefined && block.x !== undefined && block.y !== undefined
            ? datasetToPoints({dataset, x: block.x, y: block.y})
            : [];
      return (
        <Box gap={2} key={path} testID={path}>
          {block.title ? <Heading size="sm">{block.title}</Heading> : null}
          <Chart
            data={points}
            emptyText={block.emptyText}
            height={chartHeight(block.height)}
            legendLabel={block.legend ? block.title : undefined}
            loading={dataName !== undefined && context.loadingIds.has(dataName)}
            testID={`${path}-chart`}
          />
        </Box>
      );
    }
    case "table":
      return <TableBlockView block={block} context={context} key={path} path={path} />;
    case "gallery":
      return <GalleryBlockView block={block} context={context} key={path} path={path} />;
    case "list":
      return renderList(block, path, context);
    case "stepper":
      return renderStepper(block, path, context);
    case "checklist":
      return renderChecklist(block, path, context);
    case "actions":
      return (
        <Box direction="row" gap={2} key={path} testID={path} wrap>
          {block.elements.map((element) => {
            if (element.type === "segmented") {
              const selectedData =
                context.selections[element.target] ?? context.boundData?.[element.target];
              const selectedIndex = Math.max(
                0,
                element.options.findIndex((option) => option.data === selectedData)
              );
              return (
                <SegmentedControl
                  items={element.options.map((option) => option.label)}
                  key={element.id}
                  onChange={(index) => {
                    const option = element.options[index];
                    if (option === undefined) {
                      return;
                    }
                    context.setSelection(element.target, option.data);
                    context.onAction?.({
                      action: {data: option.data, kind: "select", target: element.target},
                      blockId: block.id,
                      elementId: element.id,
                    });
                  }}
                  selectedIndex={selectedData === undefined ? 0 : selectedIndex}
                  testID={`${path}-${element.id}`}
                />
              );
            }
            const action = element.action;
            if (action.kind === "copy") {
              return (
                <CopyButton
                  action={action}
                  context={context}
                  key={element.id}
                  testID={`${path}-${element.id}`}
                  text={element.text}
                  variant={element.variant}
                />
              );
            }
            const disabled =
              action.kind === "callback" &&
              context.hostActions !== undefined &&
              !context.hostActions.includes(action.name);
            return (
              <Button
                disabled={disabled}
                key={element.id}
                loading={context.pendingElementIds?.has(element.id) === true}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  if (action.kind === "select") {
                    context.setSelection(action.target, action.data);
                  }
                  context.onAction?.({
                    action,
                    blockId: block.id,
                    elementId: element.id,
                  });
                }}
                testID={`${path}-${element.id}`}
                text={element.text}
                variant={element.variant ?? "primary"}
              />
            );
          })}
        </Box>
      );
    default:
      return <Box key={path} testID={path} />;
  }
};
