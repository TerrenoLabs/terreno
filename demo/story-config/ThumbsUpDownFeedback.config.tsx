import {DemoConfiguration} from "@config";
import {
  ThumbsUpDownFeedbackDemo,
  ThumbsUpDownFeedbackStories,
  ThumbsUpDownFeedbackWithConfirmation,
} from "@stories/ThumbsUpDownFeedback.stories";
import {ThumbsUpDownFeedback} from "@terreno/ui";
import React from "react";

export const ThumbsUpDownFeedbackConfiguration: DemoConfiguration = {
  usageExample: "import {ThumbsUpDownFeedback} from \"@terreno/ui\";\n\n<ThumbsUpDownFeedback />",
  name: "ThumbsUpDownFeedback",
  related: ["AI Suggestion Box", "IconButton"],
  description:
    "ThumbsUpDownFeedback is a thumbs up / thumbs down pair for collecting a single positive or negative reaction, e.g. on an AI generated response. Pressing the selected option again clears the selection.",
  category: "Component",
  component: ThumbsUpDownFeedback,
  status: {
    documentation: "planned",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r?node-id=3800-6006",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  usage: {
    do: [
      "Use to collect a quick, low-effort reaction to a single piece of content",
      "Place it directly next to the content it applies to",
      "Persist the selection so the user can see the feedback they already gave",
    ],
    doNot: [
      "Do not use for more than two choices — use RadioField or SegmentedControl instead",
      "Do not use as a form field with a title, helper text, or validation",
      "Do not rely on the selection alone for detailed feedback — pair it with a text field when you need more",
    ],
  },
  a11yNotes: [
    "Each option has an accessibility label, customizable via positiveAccessibilityLabel and negativeAccessibilityLabel",
    "Each option is a two-state toggle: selection is announced as checked, so it is never conveyed by the glyph alone",
  ],
  interfaceName: "ThumbsUpDownFeedbackProps",
  props: {},
  demo: ThumbsUpDownFeedbackDemo,
  demoOptions: {
    size: "md",
    controls: {
      disabled: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  stories: {
    "Binary Feedback": {
      description: "All states.",
      render: () => <ThumbsUpDownFeedbackStories />,
    },
    "Inline Feedback Prompt": {
      description: "Paired with a static prompt and a confirmation line shown after feedback.",
      render: () => <ThumbsUpDownFeedbackWithConfirmation />,
    },
  },
};
