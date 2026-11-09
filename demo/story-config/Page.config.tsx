import {DemoConfiguration} from "@config";
import {PageDemo, PageLoadingBoolean, PageLoadingText} from "@stories/Page.stories";
import {Page} from "@terreno/ui";

export const PageConfiguration: DemoConfiguration = {
  usageExample: "import {Page} from \"@terreno/ui\";\n\n<Page />",
  name: "Page",
  component: Page,
  related: ["Box", "Spinner"],
  description:
    "Page is a full-screen layout container with an optional header, footer, back/close buttons, and loading state. It handles scrolling, keyboard avoidance, and max-width centering.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "PageProps",
  usage: {
    do: [
      "Use as the root layout for every screen.",
      "Pass loading={true} to show a centered spinner while data is fetching.",
      "Pass loadingText (e.g. loadingText=\"Saving…\") to display a message beneath the spinner.",
    ],
    doNot: [
      "Do not nest Page components.",
      "Do not use loading and children simultaneously — the loading state replaces content.",
    ],
  },
  props: {},
  demo: PageDemo,
  demoOptions: {
    size: "lg",
    controls: {
      title: {
        type: "text",
        defaultValue: "Page Title",
      },
      loading: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    LoadingBoolean: {
      description: "Shows a centered spinner when loading is true.",
      render: PageLoadingBoolean,
    },
    LoadingText: {
      description: "Shows a centered spinner with a message beneath it when loadingText is provided.",
      render: PageLoadingText,
    },
  },
};
