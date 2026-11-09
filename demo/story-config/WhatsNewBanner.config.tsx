import type {DemoConfiguration} from "@config";
import {WhatsNewBannerDemo, WhatsNewBannerSingleRelease} from "@stories/WhatsNewBanner.stories";
import {WhatsNewBanner} from "@terreno/ui";

export const WhatsNewBannerConfiguration: DemoConfiguration = {
  usageExample:
    'import {WhatsNewBanner} from "@terreno/ui";\n\n<WhatsNewBanner releases={[{version: "1.2.0", date: "2026-10-13", body: "### Added\\n\\n- Bulk edit."}]} />',
  a11yNotes: [
    "The open and dismiss controls are buttons with labels, reachable by keyboard.",
    "Release notes open in a Modal, which manages focus.",
  ],
  additionalDocumentation: [],
  category: "Component",
  component: WhatsNewBanner,
  demo: () => <WhatsNewBannerDemo />,
  demoOptions: {size: "lg"},
  description:
    "Non-blocking release notes banner. Shows the latest release until opened or dismissed, then hides until a newer release ships.",
  interfaceName: "WhatsNewBannerProps",
  name: "WhatsNewBanner",
  props: {},
  related: ["Banner", "MarkdownView"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    SingleRelease: {render: () => <WhatsNewBannerSingleRelease />},
  },
  usage: {
    do: [
      "Use for routine release notes that should not block the app.",
      "Order releases newest first.",
    ],
    doNot: [
      "Do not use for content people must acknowledge; use announcements with a required modal.",
    ],
  },
};
