import {registerTerrenoDevCommand} from "@terreno/syncdb";

declare const __DEV__: boolean | undefined;

export const installExampleDevMcpCommands = (): void => {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
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
