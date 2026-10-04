import type {ScreenWidgetComponent} from "../../../types";
import {AiDatasetDetailScreenWidget} from "../datasets/AiDatasetDetailScreen";
import {AiDatasetsScreenWidget} from "../datasets/AiDatasetsListScreen";
import {AiEvaluatorDetailScreenWidget} from "../evaluators/AiEvaluatorDetailScreen";
import {AiEvaluatorNewScreenWidget} from "../evaluators/AiEvaluatorNewScreen";
import {AiEvaluatorsScreenWidget} from "../evaluators/AiEvaluatorsListScreen";
import {AiExperimentNewScreenWidget} from "../experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget} from "../experiments/AiExperimentResultsScreen";
import {AiExperimentsScreenWidget} from "../experiments/AiExperimentsListScreen";
import {AiPromptEditorScreenWidget} from "../prompts/AiPromptEditorScreen";
import {AiPromptsScreenWidget} from "../prompts/AiPromptsListScreen";
import {AiReviewItemScreenWidget} from "../review/AiReviewItemScreen";
import {AiReviewScreenWidget} from "../review/AiReviewQueueScreen";
import {AiTraceDetailScreenWidget} from "../traces/AiTraceDetailScreen";
import {AiTracesScreenWidget} from "../traces/AiTracesListScreen";

export {
  AiPromptEditorScreenWidget,
  AiPromptsScreenWidget,
  AiReviewItemScreenWidget,
  AiReviewScreenWidget,
  AiTraceDetailScreenWidget,
  AiTracesScreenWidget,
};

export const AI_OBSERVABILITY_WIDGETS: Record<string, ScreenWidgetComponent> = {
  "ai-dataset-detail": AiDatasetDetailScreenWidget,
  "ai-datasets": AiDatasetsScreenWidget,
  "ai-evaluator-detail": AiEvaluatorDetailScreenWidget,
  "ai-evaluator-new": AiEvaluatorNewScreenWidget,
  "ai-evaluators": AiEvaluatorsScreenWidget,
  "ai-experiment-new": AiExperimentNewScreenWidget,
  "ai-experiment-results": AiExperimentResultsScreenWidget,
  "ai-experiments": AiExperimentsScreenWidget,
  "ai-prompt-editor": AiPromptEditorScreenWidget,
  "ai-prompts": AiPromptsScreenWidget,
  "ai-review": AiReviewScreenWidget,
  "ai-review-item": AiReviewItemScreenWidget,
  "ai-trace-detail": AiTraceDetailScreenWidget,
  "ai-traces": AiTracesScreenWidget,
};
