import type {AIRequestExplorer as AIRequestExplorerComponent} from "../AIRequestExplorer";
import type {AiSuggestionBox as AiSuggestionBoxComponent} from "../AiSuggestionBox";
import type {AreaChart as AreaChartComponent} from "../AreaChart";
import type {AttachmentPreview as AttachmentPreviewComponent} from "../AttachmentPreview";
import type {BarChart as BarChartComponent} from "../BarChart";
import type {ChartCard as ChartCardComponent} from "../ChartCard";
import type {ConflictSheet as ConflictSheetComponent} from "../ConflictSheet";
import type {ConsentFormScreen as ConsentFormScreenComponent} from "../ConsentFormScreen";
import type {ConsentNavigator as ConsentNavigatorComponent} from "../ConsentNavigator";
import type {DonutChart as DonutChartComponent} from "../DonutChart";
import type {DraggableList as DraggableListComponent} from "../DraggableList";
import type EmojiSelectorComponent from "../EmojiSelector";
import {Categories} from "../emojiCategories";
import type {GPTChat as GPTChatComponent} from "../GPTChat";
import type {GPTMemoryModal as GPTMemoryModalComponent} from "../GPTMemoryModal";
import type {LineChart as LineChartComponent} from "../LineChart";
import type {MarkdownEditor as MarkdownEditorComponent} from "../MarkdownEditor";
import type {MarkdownEditorField as MarkdownEditorFieldComponent} from "../MarkdownEditorField";
import type {Scorecard as ScorecardComponent} from "../Scorecard";
import type {SparklineChart as SparklineChartComponent} from "../SparklineChart";
import type {UpgradeRequiredScreen as UpgradeRequiredScreenComponent} from "../UpgradeRequiredScreen";
import {createLazyComponentExport, createLazyNamedExport} from "./createLazyComponentExport";

export const heavyOptionalModuleFactories = {
  AIRequestExplorer: () => import("../AIRequestExplorer"),
  AiSuggestionBox: () => import("../AiSuggestionBox"),
  AreaChart: () => import("../AreaChart"),
  AttachmentPreview: () => import("../AttachmentPreview"),
  BarChart: () => import("../BarChart"),
  ChartCard: () => import("../ChartCard"),
  ConflictSheet: () => import("../ConflictSheet"),
  ConsentFormScreen: () => import("../ConsentFormScreen"),
  ConsentNavigator: () => import("../ConsentNavigator"),
  DonutChart: () => import("../DonutChart"),
  DraggableList: () => import("../DraggableList"),
  EmojiSelector: () => import("../EmojiSelector"),
  GPTChat: () => import("../GPTChat"),
  GPTMemoryModal: () => import("../GPTMemoryModal"),
  LineChart: () => import("../LineChart"),
  MarkdownEditor: () => import("../MarkdownEditor"),
  MarkdownEditorField: () => import("../MarkdownEditorField"),
  Scorecard: () => import("../Scorecard"),
  SparklineChart: () => import("../SparklineChart"),
  UpgradeRequiredScreen: () => import("../UpgradeRequiredScreen"),
} as const;

const EMOJI_SELECTOR_DEFAULT_PROPS = {
  category: Categories.all,
  columns: 6,
  placeholder: "Search...",
  showHistory: false,
  showSearchBar: true,
  showSectionTitles: true,
  showTabs: true,
  theme: "#007AFF",
};

export const AIRequestExplorer = createLazyNamedExport(
  heavyOptionalModuleFactories.AIRequestExplorer,
  "AIRequestExplorer"
) as unknown as typeof AIRequestExplorerComponent;

export const AreaChart = createLazyNamedExport(
  heavyOptionalModuleFactories.AreaChart,
  "AreaChart"
) as unknown as typeof AreaChartComponent;

export const AiSuggestionBox = createLazyNamedExport(
  heavyOptionalModuleFactories.AiSuggestionBox,
  "AiSuggestionBox"
) as unknown as typeof AiSuggestionBoxComponent;

export const AttachmentPreview = createLazyNamedExport(
  heavyOptionalModuleFactories.AttachmentPreview,
  "AttachmentPreview"
) as unknown as typeof AttachmentPreviewComponent;

export const BarChart = createLazyNamedExport(
  heavyOptionalModuleFactories.BarChart,
  "BarChart"
) as unknown as typeof BarChartComponent;

export const ChartCard = createLazyNamedExport(
  heavyOptionalModuleFactories.ChartCard,
  "ChartCard"
) as unknown as typeof ChartCardComponent;

export const ConflictSheet = createLazyNamedExport(
  heavyOptionalModuleFactories.ConflictSheet,
  "ConflictSheet"
) as unknown as typeof ConflictSheetComponent;

export const ConsentFormScreen = createLazyNamedExport(
  heavyOptionalModuleFactories.ConsentFormScreen,
  "ConsentFormScreen"
) as unknown as typeof ConsentFormScreenComponent;

export const ConsentNavigator = createLazyNamedExport(
  heavyOptionalModuleFactories.ConsentNavigator,
  "ConsentNavigator"
) as unknown as typeof ConsentNavigatorComponent;

export const DonutChart = createLazyNamedExport(
  heavyOptionalModuleFactories.DonutChart,
  "DonutChart"
) as unknown as typeof DonutChartComponent;

export const DraggableList = createLazyNamedExport(
  heavyOptionalModuleFactories.DraggableList,
  "DraggableList"
) as unknown as typeof DraggableListComponent;

export const EmojiSelector = createLazyComponentExport(heavyOptionalModuleFactories.EmojiSelector, {
  defaultProps: EMOJI_SELECTOR_DEFAULT_PROPS,
}) as unknown as typeof EmojiSelectorComponent;

export const GPTChat = createLazyNamedExport(
  heavyOptionalModuleFactories.GPTChat,
  "GPTChat"
) as unknown as typeof GPTChatComponent;

export const LineChart = createLazyNamedExport(
  heavyOptionalModuleFactories.LineChart,
  "LineChart"
) as unknown as typeof LineChartComponent;

export const GPTMemoryModal = createLazyNamedExport(
  heavyOptionalModuleFactories.GPTMemoryModal,
  "GPTMemoryModal"
) as unknown as typeof GPTMemoryModalComponent;

export const MarkdownEditor = createLazyNamedExport(
  heavyOptionalModuleFactories.MarkdownEditor,
  "MarkdownEditor"
) as unknown as typeof MarkdownEditorComponent;

export const MarkdownEditorField = createLazyNamedExport(
  heavyOptionalModuleFactories.MarkdownEditorField,
  "MarkdownEditorField"
) as unknown as typeof MarkdownEditorFieldComponent;

export const Scorecard = createLazyNamedExport(
  heavyOptionalModuleFactories.Scorecard,
  "Scorecard"
) as unknown as typeof ScorecardComponent;

export const SparklineChart = createLazyNamedExport(
  heavyOptionalModuleFactories.SparklineChart,
  "SparklineChart"
) as unknown as typeof SparklineChartComponent;

export const UpgradeRequiredScreen = createLazyNamedExport(
  heavyOptionalModuleFactories.UpgradeRequiredScreen,
  "UpgradeRequiredScreen"
) as unknown as typeof UpgradeRequiredScreenComponent;
