import type {DemoConfiguration} from "@config";
import {SignatureDemo, SignatureFullWidth} from "@stories/Signature.stories";
import {Signature} from "@terreno/ui";

export const SignatureConfiguration: DemoConfiguration = {
  usageExample: "import {Signature} from \"@terreno/ui\";\n\n<Signature />",
  a11yNotes: ["The pad is a drawing surface; SignatureField adds labels and required-state copy."],
  additionalDocumentation: [],
  category: ["Component", "Form"],
  component: Signature,
  demo: () => <SignatureDemo />,
  demoOptions: {size: "lg"},
  description: "Raw signature canvas used inside SignatureField.",
  interfaceName: "SignatureProps",
  name: "Signature",
  props: {},
  related: ["Signature field", "Signature capture field"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    FullWidth: {render: () => <SignatureFullWidth />},
  },
  usage: {
    do: ["Use SignatureField when the product needs a label, error, or disabled state."],
    doNot: ["Do not require a live backend to capture a stroke."],
  },
};
