import {describe, expect, it, mock} from "bun:test";

const registerTerrenoDevCommand = mock(
  (_def: {
    description: string;
    handler: (args: Record<string, unknown>) => unknown;
    inputSchema: Record<string, unknown>;
    name: string;
  }): void => {}
);

mock.module("@terreno/syncdb", () => ({
  registerTerrenoDevCommand,
}));

describe("installExampleDevMcpCommands", () => {
  it("registers mcpPing and handler returns json for MCP smoke", async (): Promise<void> => {
    const {installExampleDevMcpCommands} = await import(`./devMcpCommands.ts?t=${Date.now()}`);
    installExampleDevMcpCommands();
    expect(registerTerrenoDevCommand.mock.calls.length).toBe(1);
    const def = registerTerrenoDevCommand.mock.calls[0]?.[0];
    expect(def?.name).toBe("mcpPing");
    expect(
      def?.handler({
        label: "hi",
      })
    ).toEqual({label: "hi", ok: true});
    expect(def?.handler({})).toEqual({label: "example", ok: true});
  });
});
