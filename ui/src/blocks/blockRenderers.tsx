import type {Block, BlockAction, InlineDataset} from "@terreno/blocks";
import type React from "react";

import {Accordion} from "../Accordion";
import {AreaChart} from "../AreaChart";
import {Badge} from "../Badge";
import {Banner} from "../Banner";
import {BarChart} from "../BarChart";
import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {DataTable} from "../DataTable";
import {DonutChart} from "../DonutChart";
import {Heading} from "../Heading";
import {HtmlFrame} from "../HtmlFrame";
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
    case "table": {
      const dataName =
        (block.id !== undefined ? context.selections[block.id] : undefined) ?? block.data;
      const dataset = dataName === undefined ? undefined : context.resolved[dataName];
      const names = block.columns ?? dataset?.columns.map((column) => column.name) ?? [];
      const indexes = names.map(
        (name) => dataset?.columns.findIndex((column) => column.name === name) ?? -1
      );
      return (
        <Box gap={2} key={path} testID={path}>
          {block.title ? <Heading size="sm">{block.title}</Heading> : null}
          <DataTable
            columns={names.map((name) => ({columnType: "text", title: name, width: 120}))}
            data={(dataset?.rows ?? []).map((row) =>
              indexes.map((index) => ({value: index < 0 ? "" : row[index]}))
            )}
            testID={`${path}-table`}
          />
        </Box>
      );
    }
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
