import {DemoConfiguration} from "@config";
import {
  AllButtonIconVariants,
  ConfirmationIconButton,
  IconButtonDemo,
  IconButtonSizes,
  IconButtonStates,
  IndicatorIconButton,
  LoadingIconButton,
  NavigationIconButton,
  ToolTipIconButton,
} from "@stories/IconButton.stories";
import {IconButton} from "@terreno/ui";

export const IconButtonConfiguration: DemoConfiguration = {
  usageExample: "import {IconButton} from \"@terreno/ui\";\n\n<IconButton />",
  name: "IconButton",
  component: IconButton,
  related: ["Button", "Icon"],
  description: "Icon buttons allow users to take actions and make choices with a single tap.",
  a11yNotes: [
    "Ensure that each IconButton has an appropriate accessibilityLabel that describes the action it performs.",
    "If the button has a confirmation dialog, indicate this with an appropriate accessibilityHint.",
    "When using icons, provide clear and consistent iconography that users can easily understand.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Terreno-Design-System?node-id=1805-12627&t=J847q9JMSjR8oQmN-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [
    {name: "Icon Guidelines", link: "https://www.nngroup.com/articles/icon-guidelines/"},
  ],
  interfaceName: "IconButtonProps",
  usage: {
    do: [
      "Use to trigger an action or progression within a task or flow.",
      "Use concise, descriptive icons that are easily recognizable.",
      "Provide accessible labels that describe the button's action.",
    ],
    doNot: [
      "Do not use without an accessible label.",
      "Avoid using icons that are not easily recognizable or understood by users.",
    ],
  },
  props: {},
  demo: IconButtonDemo,
  demoOptions: {
    controls: {
      variant: {
        type: "select",
        defaultValue: "primary",
        options: [
          {label: "Primary", value: "primary"},
          {label: "Secondary", value: "secondary"},
          {label: "Muted", value: "muted"},
          {label: "Destructive", value: "destructive"},
          {label: "Ghost", value: "ghost"},
          {label: "Disabled", value: "disabled"},
        ],
      },
      state: {
        type: "select",
        defaultValue: "default",
        options: [
          {label: "Default", value: "default"},
          {label: "Active", value: "active"},
        ],
      },
      iconName: {
        type: "select",
        defaultValue: "plus",
        options: [
          {label: "Plus", value: "plus"},
          {label: "Check", value: "check"},
          {label: "Arrow", value: "arrow-down-short-wide"},
          {label: "Minus", value: "minus"},
          {label: "Close", value: "close"},
          {label: "Info", value: "info"},
          {label: "Trash", value: "trash"},
          {label: "Edit", value: "edit"},
          {label: "Download", value: "download"},
          {label: "Archive", value: "box-archive"},
        ],
      },
      withConfirmation: {
        type: "boolean",
        defaultValue: false,
      },
      size: {
        type: "select",
        defaultValue: "default",
        options: [
          {label: "Default", value: "default"},
          {label: "Small", value: "sm"},
        ],
      },
    },
  },
  stories: {
    Variants: {render: () => AllButtonIconVariants({})},
    States: {render: () => IconButtonStates({})},
    Sizes: {render: () => IconButtonSizes({})},
    Confirmation: {render: () => ConfirmationIconButton({})},
    WithToolTip: {render: () => ToolTipIconButton({})},
    Loading: {render: () => LoadingIconButton({})},
    Indicator: {render: () => IndicatorIconButton({})},
    Navigation: {render: () => NavigationIconButton({})},
  },
};
