import {describe, expect, it, mock} from "bun:test";

const registerTerrenoDevClientDispatch = mock(
  (_dispatch: {dispatch: (action: {payload?: unknown; type: string}) => unknown}): void => {}
);

const registerTerrenoDevCommand = mock(
  (_def: {
    description: string;
    handler: (args: Record<string, unknown>) => unknown;
    inputSchema: Record<string, unknown>;
    name: string;
  }): void => {}
);

mock.module("@terreno/syncdb", () => ({
  registerTerrenoDevClientDispatch,
  registerTerrenoDevCommand,
}));

describe("installExampleDevMcpCommands", () => {
  it("registers mcpPing and handler returns json for MCP smoke", async (): Promise<void> => {
    const {installExampleDevMcpCommands} = await import(`./devMcpCommands.ts?t=${Date.now()}`);
    installExampleDevMcpCommands();
    expect(registerTerrenoDevClientDispatch.mock.calls.length).toBe(1);
    expect(registerTerrenoDevCommand.mock.calls.length).toBe(1);
    const dispatchDef = registerTerrenoDevClientDispatch.mock.calls[0]?.[0];
    expect(dispatchDef?.dispatch({payload: {n: 1}, type: "demo/ping"})).toEqual({
      payload: {n: 1},
      receivedType: "demo/ping",
    });
    const def = registerTerrenoDevCommand.mock.calls[0]?.[0];
    expect(def?.name).toBe("mcpPing");
    expect(
      def?.handler({
        label: "hi",
      })
    ).toEqual({label: "hi", ok: true});
    expect(def?.handler({})).toEqual({label: "example", ok: true});
  });

  it("no-ops when __DEV__ is false", async (): Promise<void> => {
    registerTerrenoDevClientDispatch.mock.calls.length = 0;
    registerTerrenoDevCommand.mock.calls.length = 0;
    (globalThis as {__DEV__?: boolean}).__DEV__ = false;
    const {installExampleDevMcpCommands} = await import(`./devMcpCommands.ts?t=${Date.now()}`);
    installExampleDevMcpCommands();
    expect(registerTerrenoDevClientDispatch.mock.calls.length).toBe(0);
    expect(registerTerrenoDevCommand.mock.calls.length).toBe(0);
    Reflect.deleteProperty(globalThis as {__DEV__?: boolean}, "__DEV__");
  });
});
