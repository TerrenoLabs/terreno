import {DemoConfiguration} from "@config";
import {
  SidebarNavigationDemo,
  SidebarNavigationLiveDemo,
  SidebarNavigationManyItems,
  SidebarNavigationMinimal,
} from "@stories/SidebarNavigation.stories";
import {SidebarNavigation, SidebarNavigationPanel} from "@terreno/ui";

const colorOptions = [
  {label: "Default", value: ""},
  {label: "White", value: "#FFFFFF"},
  {label: "Light gray", value: "#F3F4F6"},
  {label: "Dark", value: "#1F2937"},
  {label: "Navy", value: "#1E3A5F"},
  {label: "Purple", value: "#6D28D9"},
];

const badgeStatusOptions = [
  {label: "Error (default)", value: "error"},
  {label: "Info", value: "info"},
  {label: "Neutral", value: "neutral"},
  {label: "Success", value: "success"},
  {label: "Warning", value: "warning"},
];

export const SidebarNavigationConfiguration: DemoConfiguration = {
  usageExample: "import {SidebarNavigationPanel} from \"@terreno/ui\";\n\n<SidebarNavigationPanel />",
  name: "Sidebar navigation (non-expo)",
  component: SidebarNavigationPanel,
  related: ["Sidebar navigation (expo-router)", "Side drawer", "Page"],
  description:
    "Standalone sidebar panel without expo-router dependency. Renders a collapsible icon rail on web that expands on hover, and a hamburger-triggered slide-in drawer on mobile. Use this when you need sidebar navigation outside of an expo-router layout context.",
  a11yNotes: [
    "Each navigation item is a pressable with an accessibility label matching the item label.",
    "The hamburger menu button on mobile has an accessibility label for screen readers.",
  ],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SidebarNavigationPanelProps",
  usage: {
    do: [
      "Use when you need sidebar navigation without expo-router (e.g. demos, custom navigation stacks).",
      "Place frequently used routes in topItems and secondary actions (settings, logout) in bottomItems.",
    ],
    doNot: [
      "Do not use for temporary or contextual navigation — use Side Drawer instead.",
      "Do not put too many items in either group — consider grouping under sub-routes.",
    ],
  },
  props: {},
  demo: (props: Partial<React.ComponentProps<typeof SidebarNavigationDemo>>) => (
    <SidebarNavigationDemo {...props} />
  ),
  demoOptions: {
    size: "lg",
    controls: {
      panelBackgroundColor: {
        defaultValue: "",
        options: colorOptions,
        title: "Panel background color",
        type: "select",
      },
      itemBackgroundColor: {
        defaultValue: "",
        options: colorOptions,
        title: "Item background color",
        type: "select",
      },
      badgeStatus: {
        defaultValue: "error",
        options: badgeStatusOptions,
        title: "Badge status",
        type: "select",
      },
    },
  },
  stories: {
    Default: {render: () => <SidebarNavigationDemo />},
    Minimal: {
      description: "A sidebar with only a few items.",
      render: () => <SidebarNavigationMinimal />,
    },
    ManyItems: {
      description: "A sidebar with many navigation items in both groups.",
      render: () => <SidebarNavigationManyItems />,
    },
  },
};

export const SidebarNavigationExpoRouterConfiguration: DemoConfiguration = {
  usageExample: "import {SidebarNavigation} from \"@terreno/ui\";\n\n<SidebarNavigation />",
  name: "Sidebar navigation (expo-router)",
  component: SidebarNavigation,
  related: ["Sidebar navigation (non-expo)", "Side drawer", "Page"],
  description:
    "Custom expo-router navigator providing sidebar navigation. On web it renders a collapsed icon rail that expands on hover. On mobile it renders a hamburger-triggered slide-in drawer. Use in _layout.tsx files to get file-based routing with a sidebar.",
  a11yNotes: [
    "Each navigation item is a pressable with an accessibility label matching the item label.",
    "The hamburger menu button on mobile has an accessibility label for screen readers.",
  ],
  category: "Component",
  status: {
    documentation: "inProgress",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SidebarNavigationProps",
  usage: {
    do: [
      "Use in _layout.tsx as a custom expo-router navigator for sidebar-based navigation.",
      "Place frequently used routes in topItems and secondary actions (settings, logout) in bottomItems.",
    ],
    doNot: [
      "Do not use for temporary or contextual navigation — use Side Drawer instead.",
      "Do not put too many items in either group — consider grouping under sub-routes.",
    ],
  },
  props: {},
  demo: (props: Partial<React.ComponentProps<typeof SidebarNavigationDemo>>) => (
    <SidebarNavigationDemo {...props} />
  ),
  demoOptions: {
    size: "lg",
    controls: {
      panelBackgroundColor: {
        defaultValue: "",
        options: colorOptions,
        title: "Panel background color",
        type: "select",
      },
      itemBackgroundColor: {
        defaultValue: "",
        options: colorOptions,
        title: "Item background color",
        type: "select",
      },
      badgeStatus: {
        defaultValue: "error",
        options: badgeStatusOptions,
        title: "Badge status",
        type: "select",
      },
    },
  },
  stories: {
    LiveDemo: {
      description:
        "SidebarNavigation must be used as an expo-router layout. Open the live demo to see real route navigation.",
      render: () => <SidebarNavigationLiveDemo />,
    },
  },
};
