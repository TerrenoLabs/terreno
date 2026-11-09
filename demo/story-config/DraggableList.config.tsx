import type {DemoConfiguration} from "@config";
import {DraggableListDemo, DraggableListTwoItems} from "@stories/DraggableList.stories";
import {DraggableList} from "@terreno/ui";

export const DraggableListConfiguration: DemoConfiguration = {
  usageExample: "import {DraggableList} from \"@terreno/ui\";\n\n<DraggableList />",
  a11yNotes: ["Reorder via the grip; keep item labels readable while dragging."],
  additionalDocumentation: [],
  category: "Component",
  component: DraggableList,
  demo: () => <DraggableListDemo />,
  demoOptions: {size: "lg"},
  description: "Reorderable list with a drag grip. Drag is limited on some web setups.",
  interfaceName: "DragListProps",
  name: "DraggableList",
  props: {},
  related: ["Box"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    TwoItems: {render: () => <DraggableListTwoItems />},
  },
  usage: {
    do: ["Pass stable string ids and update order from callbackNewDataIds."],
    doNot: ["Do not mutate dataIDs in place; replace the array from the callback."],
  },
};
