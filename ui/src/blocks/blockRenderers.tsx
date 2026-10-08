import {
  type Block,
  type BlockAction,
  type ChecklistBlock,
  type ChecklistItem,
  checklistElementId,
  type DatasetColumn,
  type InlineDataset,
  type StepperBlock,
  stepperElementIds,
  type TableBlock,
} from "@terreno/blocks";
import type React from "react";
import {useCallback, useState} from "react";

import {Accordion} from "../Accordion";
import {AreaChart} from "../AreaChart";
import {Badge} from "../Badge";
import {Banner} from "../Banner";
import {BarChart} from "../BarChart";
import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {CheckBox} from "../CheckBox";
import type {DataTableColumn, LayoutChangeEvent} from "../Common";
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
  const decreaseDisabled = isLocked || block.value <= block.min;
  const increaseDisabled = isLocked || block.value >= block.max;
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

const ChecklistRowContent: React.FC<{
  checkboxTestID: string;
  isChecked: boolean;
  item: ChecklistItem;
}> = ({checkboxTestID, isChecked, item}) => (
  <>
    <Box paddingY={1}>
      <CheckBox selected={isChecked} testID={checkboxTestID} />
    </Box>
    <Box flex="grow" gap={1}>
      {item.meta ? (
        <Text color="secondaryLight" size="sm">
          {item.meta}
        </Text>
      ) : null}
      <Text bold>{item.text}</Text>
      {item.detail ? (
        <Text color="secondaryLight" size="sm">
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
                <ChecklistRowContent
                  checkboxTestID={`${itemPath}-checkbox`}
                  isChecked={isChecked}
                  item={item}
                />
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
      title: name,
      width,
    };
  });
  return (
    <Box gap={2} onLayout={handleLayout} testID={path}>
      {block.title ? <Heading size="sm">{block.title}</Heading> : null}
      <DataTable
        columns={columns}
        data={(dataset?.rows ?? []).map((row) =>
          indexes.map((index) => ({value: index < 0 ? "" : row[index]}))
        )}
        testID={`${path}-table`}
      />
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
