import "../../ui/src/bunSetup";
import {mock} from "bun:test";
import React from "react";

// Loaded after the UI test preload mocks react-native. Static imports would be
// evaluated too early and parse react-native's Flow entry.
const actualUi = await import("@terreno/ui");
const actualSdk = await import("@/store/sdk");
const actualSyncDbSdk = await import("@/store/syncDbSdk");

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
  resolveAskFilesAsDataUrls: async (): Promise<[]> => [],
  Scorecard: createUiElement("Scorecard"),
  SideDrawer: ({
    children,
    renderContent,
    ...props
  }: MockUiProps & {renderContent?: () => React.ReactNode}): React.ReactElement =>
    React.createElement("SideDrawer", props, children, renderContent?.()),
  selectedFileMimeType: (file: {mimeType?: string; name: string}): string => {
    if (file.name.endsWith(".csv")) {
      return "text/csv";
    }
    return file.mimeType ?? "application/octet-stream";
  },
  TerrenoProvider: createUiElement("TerrenoProvider"),
  Text: createUiElement("Text"),
  useStoredState: () => ["", async (): Promise<void> => undefined, false],
};

// Chart and notification stand-ins stay mocked. Other UI exports stay real so
// screens such as Documents can render SegmentedControl.
const uiModuleMock = {
  ...actualUi,
  ...uiMocks,
  TerrenoProvider: actualUi.TerrenoProvider,
};

mock.module("@terreno/ui", () => uiModuleMock);
mock.module("../../ui/dist/index.js", () => uiModuleMock);
mock.module("../../ui/src/index.tsx", () => uiModuleMock);

const sdkModuleMock = {
  ...actualSdk,
  useSummarizeExampleTextMutation: () => [
    () => ({unwrap: async (): Promise<{output: string}> => ({output: ""})}),
    {isLoading: false},
  ],
};

mock.module("@/store/sdk", () => sdkModuleMock);

const syncDbSdkMocks = {
  ...actualSyncDbSdk,
  useTodos: () => ({data: []}),
};

mock.module("@/store/syncDbSdk", () => syncDbSdkMocks);
mock.module("../store/syncDbSdk.ts", () => syncDbSdkMocks);
mock.module("../store/syncDbSdk", () => syncDbSdkMocks);
