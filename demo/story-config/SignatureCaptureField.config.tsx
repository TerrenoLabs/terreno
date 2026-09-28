import {DemoConfiguration} from "@config";
import {SignatureCaptureField} from "@terreno/ui";
import React from "react";

import {
  SignatureCaptureFieldDemo,
  SignatureCaptureFieldDemoDisabled,
  SignatureCaptureFieldDemoDrawFirst,
  SignatureCaptureFieldDemoWithError,
} from "../stories/SignatureCaptureField.stories";

export const SignatureCaptureFieldConfiguration: DemoConfiguration = {
  usageExample: "import {SignatureCaptureField} from \"@terreno/ui\";\n\n<SignatureCaptureField />",
  name: "Signature capture field",
  component: SignatureCaptureField,
  related: ["Signature field", "Typed signature field"],
  description:
    "Lets a user sign by drawing or by typing their name and choosing a font, chosen via a " +
    "Draw/Type toggle. Works the same on web and mobile and emits a discriminated value the " +
    "consumer can persist and re-render.",
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
  interfaceName: "SignatureCaptureFieldProps",
  usage: {
    do: [
      "Offer both draw and type so users can sign however works best on their device.",
      "Tell the user why an error has occurred (e.g. a signature is required).",
    ],
    doNot: [
      "Do not assume the value is always a drawn image — branch on the `mode` discriminant.",
    ],
  },
  props: {},
  demo: SignatureCaptureFieldDemo,
  demoOptions: {},
  stories: {
    "Signature Capture Field": {
      render: () => <SignatureCaptureFieldDemo />,
    },
    "Draw Mode First": {
      render: () => <SignatureCaptureFieldDemoDrawFirst />,
    },
    "Signature Capture Field With Error": {
      render: () => <SignatureCaptureFieldDemoWithError />,
    },
    "Signature Capture Field Disabled": {
      render: () => <SignatureCaptureFieldDemoDisabled />,
    },
  },
};
