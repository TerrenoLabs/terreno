import {
  listTerrenoDevCommandSummaries,
  registerTerrenoDevClientDispatch,
  registerTerrenoDevCommand,
} from "@terreno/syncdb";

declare const __DEV__: boolean | undefined;

export const installExampleDevMcpCommands = (): void => {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  registerTerrenoDevClientDispatch({
    dispatch: ({payload, type}) => ({payload: payload ?? null, receivedType: type}),
  });
  // The dev server's static renderer re-evaluates app/_layout.tsx in the same process for each
  // newly bundled route, and a second registration throws, so register once.
  if (listTerrenoDevCommandSummaries().some((command) => command.name === "mcpPing")) {
    return;
  }
  registerTerrenoDevCommand({
    description: "Returns a small JSON payload for MCP invoke_dev_command smoke tests.",
    handler: ({label}) => ({
      label: typeof label === "string" ? label : "example",
      ok: true,
    }),
    inputSchema: {
      properties: {label: {description: "Optional label", type: "string"}},
      type: "object",
    },
    name: "mcpPing",
  });
};
