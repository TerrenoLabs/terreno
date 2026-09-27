import {DemoConfiguration} from "@config";
import {ConsentFormScreen} from "@terreno/ui";
import React, {type ReactElement} from "react";

import {ConsentFormScreenDemo} from "../stories/ConsentFormScreen.stories";

const renderConsentFormScreenDemo = (): ReactElement => <ConsentFormScreenDemo />;

export const ConsentFormScreenConfiguration: DemoConfiguration = {
  usageExample: "import {ConsentFormScreen} from \"@terreno/ui\";\n\n<ConsentFormScreen />",
  name: "ConsentFormScreen",
  component: ConsentFormScreen,
  related: ["Button", "Signature field"],
  description: "The consent form screen renders consent content, required acknowledgements, signatures, and actions.",
  a11yNotes: [],
  category: "Pattern",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "ConsentFormScreenProps",
  usage: {
    do: ["Show required acknowledgements and signature requirements before enabling agree."],
    doNot: ["Do not hide decline when the form allows declining."],
  },
  props: {},
  demo: renderConsentFormScreenDemo,
  demoOptions: {size: "lg"},
  stories: {
    "With signature and decline": {
      render: () => <ConsentFormScreenDemo />,
    },
  },
};
