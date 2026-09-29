import {DemoConfiguration} from "@config";
import {AccordionDemo, AccordionDevDemo, AccordionOnToggleDemo} from "@stories/Accordion.stories";
import {Accordion} from "@terreno/ui";

export const AccordionConfiguration: DemoConfiguration = {
  usageExample: "import {Accordion} from \"@terreno/ui\";\n\n<Accordion />",
  name: "Accordion",
  component: Accordion,
  related: [],
  description:
    "Accordion is a container that can be expanded and collapsed to show content about a single subject. Its contents can be visible at all items, or expand and collapse as an individual item or a group of items. Also called “drawer”, “collapsed section”, “expandable section”, or “dropdown section”.",
  a11yNotes: [],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "ready",
    figmaLink:
      "https://www.figma.com/design/ykXj5qjjtFjOYkAvTasu9r/Flourish-Health-Design-System?node-id=3318-6026&t=Qm7RCZRrCGRgEA7b-1",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [{name: "NN/g article", link: "https://www.nngroup.com/articles/"}],
  interfaceName: "AccordionProps",
  usage: {
    do: [
      "Use accordions to group and organize content to keep the page clean and digestible.",
      "Use them to isplay additional related content about a particular subject.",
      "Enable users to reveal or hide additional content as necessary.",
    ],
    doNot: [
      "Obscure important information",
      "Use an accordion when the content is crucial to read in full",
      "Add too much content to the accordion (for example, multiple pages worth of information in one collapsed section)",
      "Use an accordion when there is insufficient content to condense",
    ],
  },
  props: {},
  demo: AccordionDemo,
  demoOptions: {},
  stories: {
    "Accordion Demo": {
      render: () => AccordionDevDemo(),
    },
    "Accordion OnToggle Demo": {
      render: () => AccordionOnToggleDemo(),
    },
  },
};
