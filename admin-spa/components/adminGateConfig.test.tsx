import {describe, expect, it} from "bun:test";
import type {AdminConfigResponse} from "@terreno/admin-frontend";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminGateConfigProvider, useAdminGateConfig} from "./adminGateConfig";

const config = {
  models: [
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Todo",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
      syncCollection: "todos",
    },
  ],
} as unknown as AdminConfigResponse;

const renderProbe = (ui: (probe: React.ReactElement) => React.ReactElement): unknown[] => {
  const seen: unknown[] = [];
  const Probe: React.FC = () => {
    seen.push(useAdminGateConfig());
    return null;
  };
  renderWithTheme(ui(<Probe />));
  return seen;
};

describe("useAdminGateConfig", () => {
  it("returns the gate's config on the first render so the bridge never swaps providers", () => {
    const seen = renderProbe((probe) => (
      <AdminGateConfigProvider config={config}>{probe}</AdminGateConfigProvider>
    ));

    expect(seen.length).toBeGreaterThan(0);
    for (const value of seen) {
      expect(value).toBe(config);
    }
  });

  it("returns null on routes the gate renders without a config", () => {
    const seen = renderProbe((probe) => (
      <AdminGateConfigProvider config={null}>{probe}</AdminGateConfigProvider>
    ));

    expect(seen.every((value) => value === null)).toBe(true);
  });

  it("returns null outside the provider", () => {
    const seen = renderProbe((probe) => probe);

    expect(seen.every((value) => value === null)).toBe(true);
  });
});
