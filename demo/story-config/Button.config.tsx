import type {DemoConfiguration} from "@config";
import {
  ButtonDemo,
  ButtonIconPosition,
  ButtonLoading,
  ButtonPressAnimations,
  ButtonSizes,
  ButtonStates,
  ButtonVariants,
  ConfirmationButton,
  FullWidthButtons,
  MultilineButtons,
  WrapTextButtons,
} from "@stories/Button.stories";
import {Button} from "@terreno/ui";

const BUTTON_USAGE_EXAMPLE = `import {Button} from "@terreno/ui";

<Button onClick={() => {}} text="Save" />`;

export const ButtonConfiguration: DemoConfiguration = {
  name: "Button",
  component: Button,
  related: ["Card", "Modal", "Table icon button"],
  usageExample: BUTTON_USAGE_EXAMPLE,
  description:
    "Buttons allow users to perform actions within a surface. They can be used alone for immediate action. Also known as CTA (call to action).",
  a11yNotes: [
    "Use disabled buttons very rarely. Here’s an article with more details.",
    "If the button text doesn’t provide sufficient context about a button’s behavior to a screen reader, provide a short descriptive label.",
    "When Button text does not provide sufficient context about the Button’s behavior, supply a short, descriptive label for screen-readers using accessibilityLabel. Texts like 'Click here', 'Follow', or 'Shop' can be confusing when a screen reader reads them out of context. In those cases, we must pass an alternative text with deeper context to replace the Button text, like 'Follow Ryan' or 'Shop Wedding Invitations'.",
    "If Button is used as a control Button to show/hide a Popover-based , we recommend passing the following ARIA attributes to assist screen readers: accessibilityLabel, accessibilityControls, accessibilityHaspopup.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Terreno-Design-System?node-id=301-4654&t=J847q9JMSjR8oQmN-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [{name: "NN/g article", link: "https://www.nngroup.com/articles/"}],
  interfaceName: "ButtonProps",
  usage: {
    do: [
      "Use to trigger an action or progression within a task or flow.",
      "Use concise, descriptive language.",
      "Use the primary style for the most important action on a page or section.",
      "Use disabled buttons very sparingly.",
    ],
    doNot: [
      "Do not use a button to direct users to an anchor link. Instead, use a simple link.",
      "Add multiple lines of text.",
      "Use two icons in one button.",
    ],
  },
  props: {},
  demo: (props) => <ButtonDemo {...props} />,
  demoOptions: {
    controls: {
      variant: {
        type: "select",
        defaultValue: "primary",
        options: [
          {label: "Primary", value: "primary"},
          {label: "Secondary", value: "secondary"},
          {label: "Outline", value: "outline"},
          {label: "Muted", value: "muted"},
          {label: "Destructive", value: "destructive"},
          {label: "Ghost", value: "ghost"},
        ],
      },
      iconName: {
        type: "select",
        defaultValue: undefined,
        options: [
          {label: "None", value: ""},
          {label: "Check", value: "check"},
          {label: "Arrow", value: "arrow-down-short-wide"},
          {label: "Plus", value: "plus"},
          {label: "Minus", value: "minus"},
        ],
      },
      iconPosition: {
        type: "select",
        defaultValue: "left",
        options: [
          {label: "Left", value: "left"},
          {label: "Right", value: "right"},
        ],
      },
      fullWidth: {
        type: "boolean",
        defaultValue: false,
      },
      pressAnimation: {
        type: "select",
        defaultValue: "scale",
        options: [
          {label: "Scale", value: "scale"},
          {label: "Opacity", value: "opacity"},
          {label: "None", value: "none"},
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
      withConfirmation: {
        type: "boolean",
        defaultValue: false,
      },
      wrapText: {
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
    Variants: {
      interactions: [
        {action: "expectText", value: "Default/Primary"},
        {action: "press", targetTestID: "button-variant-primary"},
      ],
      render: () => <ButtonVariants />,
    },
    States: {render: () => <ButtonStates />},
    Sizes: {render: () => <ButtonSizes />},
    IconPosition: {render: () => <ButtonIconPosition />},
    Loading: {render: () => <ButtonLoading />},
    Confirmation: {render: () => <ConfirmationButton />},
    FullWidth: {render: () => <FullWidthButtons />},
    PressAnimations: {render: () => <ButtonPressAnimations />},
    Multiline: {render: () => <MultilineButtons />, showInDemo: false},
    WrapText: {render: () => <WrapTextButtons />},
  },
};
