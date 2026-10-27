import {DemoConfiguration} from "@config";
import {
  BoxLoading,
  CardLoading,
  CustomComponentLoading,
  SkeletonAnimations,
  SkeletonDemo,
  SkeletonShapes,
} from "@stories/Skeleton.stories";
import {Skeleton} from "@terreno/ui";

export const SkeletonConfiguration: DemoConfiguration = {
  usageExample:
    'import {Box, SkeletonList} from "@terreno/ui";\n\n<Box loading={isLoading} loadingComponent={<SkeletonList rows={3} />}>\n  {rows}\n</Box>',
  name: "Skeleton",
  component: Skeleton,
  related: ["Box", "Card", "Spinner"],
  description:
    "Skeletons are placeholders in the shape of content that is still loading. Pass one as `loadingComponent` to Box, Card, ChartCard, Scorecard, Page, SplitPage, or a chart, or wrap a custom component with `withLoading`.",
  shortDescription: "Placeholder shapes shown while content loads.",
  a11yNotes: [
    "Skeleton blocks are hidden from screen readers. The loading container sets aria-busy and announces loadingLabel (default “Loading”) instead.",
    "Animations stop when the operating system's reduce-motion setting is on.",
  ],
  category: "Component",
  status: {
    documentation: "ready",
    figma: "notSupported",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "SkeletonProps",
  usage: {
    do: [
      "Match the skeleton to the shape and size of the content it stands in for.",
      "Use Box loading and loadingComponent rather than conditionally rendering skeletons yourself.",
      "Use a Spinner instead for actions with no known layout, such as a button press.",
    ],
    doNot: [
      "Do not show skeletons for loads that finish in under about 300ms.",
      "Do not mix animations on one screen; set loadingAnimation on the container.",
    ],
  },
  props: {},
  demo: SkeletonDemo,
  demoOptions: {
    controls: {
      animation: {
        type: "select",
        options: [
          {label: "Pulse", value: "pulse"},
          {label: "Shimmer", value: "shimmer"},
          {label: "None", value: "none"},
        ],
        defaultValue: "pulse",
      },
    },
  },
  stories: {
    Shapes: {render: SkeletonShapes},
    Animations: {render: SkeletonAnimations},
    BoxLoading: {render: BoxLoading},
    CardLoading: {render: CardLoading},
    CustomComponent: {render: CustomComponentLoading},
  },
};
