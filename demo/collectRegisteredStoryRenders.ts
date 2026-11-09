import type React from "react";

import {controlDefault} from "./catalogContract";
import type {DemoConfiguration} from "./demoConfig";

export interface RegisteredStoryRender {
  id: string;
  render: () => React.ReactElement | null;
}

export const defaultDemoProps = (config: DemoConfiguration): Record<string, unknown> => {
  const controls = config.demoOptions.controls ?? {};
  const props: Record<string, unknown> = {};
  for (const [key, control] of Object.entries(controls)) {
    if (control !== undefined) {
      props[key] = controlDefault(control);
    }
  }
  return props;
};

export const collectRegisteredStoryRenders = (
  configs: DemoConfiguration[]
): RegisteredStoryRender[] => {
  const renders: RegisteredStoryRender[] = [];
  for (const config of configs) {
    renders.push({
      id: `${config.name} / demo`,
      render: () => config.demo(defaultDemoProps(config)),
    });
    for (const [storyName, story] of Object.entries(config.stories)) {
      renders.push({
        id: `${config.name} / ${storyName}`,
        render: story.render,
      });
    }
  }
  return renders;
};
