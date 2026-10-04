import type {AdminCustomScreen} from "@terreno/api";

export const AI_OBSERVABILITY_GROUP = "AI Observability";

const observabilityScreen = ({
  displayName,
  name,
  resource,
}: {
  displayName: string;
  name: string;
  resource: string;
}): AdminCustomScreen => ({
  adminAccess: {action: "list", resource},
  displayName,
  group: AI_OBSERVABILITY_GROUP,
  name,
});

export const observabilityAdminScreens = ({localOn}: {localOn: boolean}): AdminCustomScreen[] => {
  const screens: AdminCustomScreen[] = [
    observabilityScreen({displayName: "Prompts", name: "ai-prompts", resource: "aiPrompt"}),
    observabilityScreen({displayName: "Traces", name: "ai-traces", resource: "aiTrace"}),
    observabilityScreen({
      displayName: "Evaluators",
      name: "ai-evaluators",
      resource: "aiEvaluator",
    }),
    observabilityScreen({displayName: "Datasets", name: "ai-datasets", resource: "aiDataset"}),
    observabilityScreen({
      displayName: "Experiments",
      name: "ai-experiments",
      resource: "aiExperiment",
    }),
  ];
  if (localOn) {
    screens.push(
      observabilityScreen({displayName: "Review queue", name: "ai-review", resource: "aiReview"})
    );
  }
  return screens;
};
