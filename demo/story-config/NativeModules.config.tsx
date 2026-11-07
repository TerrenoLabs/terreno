import type {DemoConfiguration} from "@config";
import {NativeModulesDemo, NativeModuleVersions} from "@stories/NativeModules.stories";

// Hidden diagnostics page: reachable at /demo/Native Modules and /dev/Native Modules, but left
// out of the catalog lists because it is a build check, not a component.
export const NativeModulesConfiguration: DemoConfiguration = {
  a11yNotes: [],
  additionalDocumentation: [],
  category: "Foundation",
  component: NativeModulesDemo,
  demo: NativeModulesDemo,
  demoOptions: {size: "lg"},
  description:
    "Lists the Terreno 58 native module baseline with the installed package versions and whether each native module is linked into the running binary. Use it on a fresh dev client to confirm the build carries every module.",
  hidden: true,
  interfaceName: "NativeModulesDiagnostics",
  name: "Native Modules",
  props: {},
  related: [],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "notSupported",
    ios: "ready",
    web: "ready",
  },
  stories: {
    "Native module versions": {render: NativeModuleVersions},
  },
  usage: {
    do: ["Open this page on a new dev client before testing a feature that needs a native module."],
    doNot: ["Do not treat a web result as proof that a native build links the modules."],
  },
  usageExample: "Open /demo/Native%20Modules in the demo dev client.",
};
