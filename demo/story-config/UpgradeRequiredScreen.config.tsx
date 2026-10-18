import type {DemoConfiguration} from "@config";
import {
  UpgradeRequiredScreenCannotUpdate,
  UpgradeRequiredScreenDemo,
} from "@stories/UpgradeRequiredScreen.stories";
import {UpgradeRequiredScreen} from "@terreno/ui";

export const UpgradeRequiredScreenConfiguration: DemoConfiguration = {
  usageExample: "import {UpgradeRequiredScreen} from \"@terreno/ui\";\n\n<UpgradeRequiredScreen />",
  a11yNotes: ["The update action must remain keyboard reachable when canUpdate is true."],
  additionalDocumentation: [],
  category: "Pattern",
  component: UpgradeRequiredScreen,
  demo: () => <UpgradeRequiredScreenDemo />,
  demoOptions: {size: "lg"},
  description: "Blocking screen when the installed client is too old.",
  interfaceName: "UpgradeRequiredScreenProps",
  name: "UpgradeRequiredScreen",
  props: {},
  related: ["ErrorPage"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    CannotUpdate: {render: () => <UpgradeRequiredScreenCannotUpdate />},
  },
  usage: {
    do: ["Tell the user why they must update and what to do if self-update is unavailable."],
    doNot: ["Do not leave onUpdate undefined; pass a no-op in stories."],
  },
};
