import type {DemoConfiguration} from "@config";
import {
  OfflineBannerDemo,
  OfflineBannerIdle,
  OfflineBannerSyncing,
} from "@stories/OfflineBanner.stories";
import {OfflineBanner} from "@terreno/ui";

export const OfflineBannerConfiguration: DemoConfiguration = {
  usageExample: "import {OfflineBanner} from \"@terreno/ui\";\n\n<OfflineBanner />",
  a11yNotes: ["Keep interactive controls keyboard reachable."],
  additionalDocumentation: [],
  category: "Component",
  component: OfflineBanner,
  demo: () => <OfflineBannerDemo />,
  demoOptions: {size: "lg"},
  description: "Offline and syncing banners. Renders nothing when online and idle.",
  interfaceName: "OfflineBannerProps",
  name: "OfflineBanner",
  props: {},
  related: ["SyncStatusBanner", "Banner"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Idle: {render: () => <OfflineBannerIdle />},
    Syncing: {render: () => <OfflineBannerSyncing />},
  },
  usage: {
    do: ["Use this component for the pattern it documents in the demo."],
    doNot: ["Do not hide required callbacks; stories use no-op handlers."],
  },
};
