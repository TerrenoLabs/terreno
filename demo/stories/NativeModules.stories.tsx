import {Badge, Box, Heading, Text} from "@terreno/ui";
import type React from "react";
import {Platform} from "react-native";

import {
  type NativeModuleRow,
  type NativeModuleStatus,
  resolveNativeModuleRows,
} from "../nativeModuleBaseline";
import {StorybookContainer} from "./StorybookContainer";

const STATUS_LABELS: Record<NativeModuleStatus, string> = {
  buildOnly: "Build config",
  linked: "Linked",
  missing: "Missing",
  web: "Native only",
};

const STATUS_BADGES: Record<NativeModuleStatus, "success" | "error" | "neutral" | "info"> = {
  buildOnly: "info",
  linked: "success",
  missing: "error",
  web: "neutral",
};

const NativeModuleRowView = ({row}: {row: NativeModuleRow}): React.ReactElement => {
  return (
    <Box
      alignItems="center"
      border="default"
      direction="row"
      gap={3}
      justifyContent="between"
      padding={3}
      rounding="md"
      testID={`native-modules-row-${row.packageName}`}
    >
      <Box flex="grow" gap={1}>
        <Text bold>{row.packageName}</Text>
        <Text color="secondaryLight" size="sm">
          {row.moduleName ? `Native module: ${row.moduleName}` : "Config plugin only"}
        </Text>
      </Box>
      <Text testID={`native-modules-version-${row.packageName}`}>{row.version}</Text>
      <Badge status={STATUS_BADGES[row.status]} value={STATUS_LABELS[row.status]} />
    </Box>
  );
};

export const NativeModulesDemo = (): React.ReactElement => {
  const rows = resolveNativeModuleRows();
  const missingCount = rows.filter((row) => row.status === "missing").length;
  return (
    <Box gap={3} testID="native-modules-screen" width="100%">
      <Text>
        {Platform.OS === "web"
          ? "Web builds do not load native modules. Open this page in a dev client to check linking."
          : missingCount === 0
            ? "Every baseline module is linked into this binary."
            : `${missingCount} baseline module(s) are missing. Rebuild the dev client.`}
      </Text>
      {rows.map((row) => (
        <NativeModuleRowView key={row.packageName} row={row} />
      ))}
    </Box>
  );
};

export const NativeModuleVersions = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box gap={3}>
        <Heading size="md">Terreno 58 native module baseline</Heading>
        <Text color="secondaryLight" size="sm">
          Platform: {Platform.OS}
        </Text>
        <NativeModulesDemo />
      </Box>
    </StorybookContainer>
  );
};
