import {DemoConfiguration} from "@config";
import {TypedSignatureField} from "@terreno/ui";
import React from "react";

import {
  TypedSignatureFieldDemo,
  TypedSignatureFieldDemoDisabled,
  TypedSignatureFieldDemoPrefilled,
  TypedSignatureFieldDemoWithError,
} from "../stories/TypedSignatureField.stories";

export const TypedSignatureFieldConfiguration: DemoConfiguration = {
  usageExample: "import {TypedSignatureField} from \"@terreno/ui\";\n\n<TypedSignatureField />",
  name: "Typed signature field",
  component: TypedSignatureField,
  related: ["Signature field"],
  description:
    "Lets a user type their name and choose a signature font with a live preview. Works the " +
    "same on web and mobile, and emits a typed name plus a stable font key for persistence.",
  a11yNotes: [],
  category: ["Component", "Form"],
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "TypedSignatureFieldProps",
  usage: {
    do: [
      "Show the live preview so the user can confirm their signature before saving.",
      "Tell the user why an error has occurred (e.g. a signature is required).",
    ],
    doNot: ["Do not persist the raw font family; persist the stable font key instead."],
  },
  props: {},
  demo: TypedSignatureFieldDemo,
  demoOptions: {},
  stories: {
    "Basic Typed Signature Field": {
      render: () => <TypedSignatureFieldDemo />,
    },
    "Prefilled Typed Signature Field": {
      render: () => <TypedSignatureFieldDemoPrefilled />,
    },
    "Typed Signature Field With Error": {
      render: () => <TypedSignatureFieldDemoWithError />,
    },
    "Typed Signature Field Disabled": {
      render: () => <TypedSignatureFieldDemoDisabled />,
    },
  },
};
