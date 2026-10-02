import type {DemoConfiguration} from "@config";
import {SyncStatusBannerDemo, SyncStatusBannerOffline} from "@stories/SyncStatusBanner.stories";
import {SyncStatusBanner} from "@terreno/ui";

export const SyncStatusBannerConfiguration: DemoConfiguration = {
  usageExample: "import {SyncStatusBanner} from \"@terreno/ui\";\n\n<SyncStatusBanner />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: SyncStatusBanner,
  demo: () => <SyncStatusBannerDemo />,
  demoOptions: {size: "lg"},
  description: "Compact local-first sync chrome: queue, conflicts, offline.",
  interfaceName: "SyncStatusBannerProps",
  name: "SyncStatusBanner",
  props: {},
  related: ["OfflineBanner", "ConflictSheet"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Offline: {render: () => <SyncStatusBannerOffline />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
