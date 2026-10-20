import type {DemoConfiguration} from "@config";
import {ListDetailLayoutDemo} from "@stories/ListDetailLayout.stories";
import {ListDetailLayout} from "@terreno/ui";

export const ListDetailLayoutConfiguration: DemoConfiguration = {
  usageExample:
    'import {ListDetailIndex, ListDetailLayout} from "@terreno/ui";\n\n// app/mail/_layout.tsx\n<ListDetailLayout\n  detailHref={(id) => `/mail/${id}`}\n  indexHref="/mail"\n  list={<MailList />}\n/>\n\n// app/mail/index.tsx\n<ListDetailIndex />',
  name: "ListDetailLayout",
  component: ListDetailLayout,
  related: ["SplitPage", "Sidebar navigation (expo-router)", "Page"],
  description:
    "Route-driven list/detail layout for a route group's _layout.tsx, like a mail inbox. On a phone the list pushes the detail route. On a tablet or wide browser the list stays in a left pane and the detail opens beside it. The open item lives in the URL, so deep links and back work, and it stays open across rotation and resize.",
  shortDescription: "List/detail layout: stacked on phones, two panes on tablets.",
  a11yNotes: [
    "Mark the open row with accessibilityState={{selected: true}}; a clickable Box row sends it as aria-current on web.",
    "On a tablet the list pane comes before the detail pane in focus order.",
  ],
  category: "Pattern",
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "ListDetailLayoutProps",
  usage: {
    do: [
      "Use it as the _layout.tsx of a route group with index.tsx (ListDetailIndex) and [id].tsx.",
      "Set unstable_settings.initialRouteName to index so a deep link on a phone can go back to the list.",
      "Read and change the open item with useListDetail() in the list.",
    ],
    doNot: [
      "Do not keep list filters or search text in the list's local state; it remounts at the breakpoint.",
      "Do not use it for a list/detail view with no routes of its own; use SplitPage there.",
    ],
  },
  props: {},
  demo: () => <ListDetailLayoutDemo />,
  demoOptions: {size: "lg"},
  stories: {},
};
