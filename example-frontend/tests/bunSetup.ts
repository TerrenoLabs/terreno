import "../../ui/src/bunSetup";
import {mock} from "bun:test";
import React from "react";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

interface MockUiProps {
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  testID?: string;
  text?: string;
  title?: string;
}

const createUiElement = (name: string): React.FC<MockUiProps> => {
  return ({children, text, title, ...props}): React.ReactElement => {
    const ReactNativeText = require("react-native").Text as React.ComponentType<{
      children?: React.ReactNode;
    }>;
    return React.createElement(
      name,
      props,
      title ? React.createElement(ReactNativeText, null, title) : null,
      text ? React.createElement(ReactNativeText, null, text) : null,
      children
    );
  };
};

const uiMocks = {
  AreaChart: createUiElement("AreaChart"),
  BarChart: createUiElement("BarChart"),
  Box: createUiElement("Box"),
  Button: ({disabled, onClick, testID, text}: MockUiProps): React.ReactElement =>
    React.createElement(
      "Button",
      {
        accessibilityState: {disabled: Boolean(disabled)},
        disabled,
        onPress: disabled ? undefined : onClick,
        testID,
      },
      text
    ),
  Card: createUiElement("Card"),
  DashboardGrid: createUiElement("DashboardGrid"),
  DashboardGridItem: createUiElement("DashboardGridItem"),
  DonutChart: createUiElement("DonutChart"),
  Heading: createUiElement("Heading"),
  LineChart: createUiElement("LineChart"),
  NotificationBell: createUiElement("NotificationBell"),
  NotificationInbox: createUiElement("NotificationInbox"),
  NotificationPreferences: createUiElement("NotificationPreferences"),
  Page: createUiElement("Page"),
  Scorecard: createUiElement("Scorecard"),
  SideDrawer: ({
    children,
    renderContent,
    ...props
  }: MockUiProps & {renderContent?: () => React.ReactNode}): React.ReactElement =>
    React.createElement("SideDrawer", props, children, renderContent?.()),
  TerrenoProvider: createUiElement("TerrenoProvider"),
  Text: createUiElement("Text"),
  useStoredState: () => ["", async (): Promise<void> => undefined, false],
};

mock.module("@terreno/ui", () => uiMocks);
mock.module("../../ui/dist/index.js", () => uiMocks);
mock.module("../../ui/src/index.tsx", () => uiMocks);

mock.module("@/store/sdk", () => ({
  useSummarizeExampleTextMutation: () => [
    () => ({unwrap: async (): Promise<{output: string}> => ({output: ""})}),
    {isLoading: false},
  ],
}));

const syncDbSdkMocks = {
  useTodos: () => ({data: []}),
};

mock.module("@/store/syncDbSdk", () => syncDbSdkMocks);
mock.module("../store/syncDbSdk.ts", () => syncDbSdkMocks);
mock.module("../store/syncDbSdk", () => syncDbSdkMocks);
