import type {DemoConfiguration} from "@config";
import {SwiperDemo, SwiperEmpty} from "@stories/Swiper.stories";
import {Swiper} from "@terreno/ui";

export const SwiperConfiguration: DemoConfiguration = {
  usageExample: "import {Swiper} from \"@terreno/ui\";\n\n<Swiper />",
  a11yNotes: ["Pagination dots should remain reachable; empty pages render nothing."],
  additionalDocumentation: [],
  category: "Pattern",
  component: Swiper,
  demo: () => <SwiperDemo />,
  demoOptions: {size: "lg"},
  description: "Onboarding page swiper used by SignUpScreen.",
  interfaceName: "SwiperProps",
  name: "Swiper",
  props: {},
  related: ["SignUpScreen"],
  status: {
    android: "ready",
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    web: "ready",
  },
  stories: {
    Empty: {render: () => <SwiperEmpty />},
  },
  usage: {
    do: ["Pass at least one page with a title for a visible carousel."],
    doNot: ["Do not assume an empty pages array shows a placeholder."],
  },
};
