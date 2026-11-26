import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {configureAdminModelApiDouble} from "../../src/testing/useAdminModelApiDouble";
import type {AdminHomeWidgetProps, AdminModelConfig} from "../../src/types";
import {ModelsGridWidget} from "../../src/widgets/ModelsGridWidget";

const models = Array.from(
  {length: 8},
  (_, index) =>
    ({
      displayName: `Model ${index}`,
      fields: {name: {required: true, type: "string"}, title: {required: false, type: "string"}},
      listFields: ["name"],
      name: `model${index}`,
      routePath: `/admin/model${index}`,
    }) as unknown as AdminModelConfig
);
const config = {customScreens: [], models, scripts: []};
const baseline: AdminHomeWidgetProps = {apiBase: "/admin", config, models, routeBase: "/admin"};
const listResult = {data: {data: [], total: 12}, error: null, isLoading: false};

describe("ModelsGridWidget renders", () => {
  it("keeps the model cards when the parent re-renders", async () => {
    configureAdminModelApiDouble({useListQuery: () => listResult});
    const report = await auditComponent({
      baseline,
      Component: ModelsGridWidget,
      changes: {
        "new models array, same models": {...baseline, models: [...models]},
        "new routeBase": {...baseline, routeBase: "/console"},
      },
      name: "ModelsGridWidget",
    });

    expect(componentStat(report, "same props", "ModelGridCard")).toBeUndefined();
    expect(componentStat(report, "new models array, same models", "ModelGridCard")).toBeUndefined();
  });
});
