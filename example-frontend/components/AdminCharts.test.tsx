import {describe, it} from "bun:test";
import {TerrenoProvider} from "@terreno/ui";
import {render} from "@testing-library/react-native";
import {assert} from "chai";

import {AdminCharts} from "./AdminCharts";

const renderAdminCharts = (): ReturnType<typeof render> => {
  return render(
    <TerrenoProvider>
      <AdminCharts />
    </TerrenoProvider>
  );
};

describe("AdminCharts", () => {
  it("renders every chart type in the admin sample dashboard", async (): Promise<void> => {
    const {findByTestId, findByText} = renderAdminCharts();

    assert.exists(await findByTestId("admin-charts"));
    assert.exists(await findByTestId("admin-charts-completed"));
    assert.exists(await findByTestId("admin-charts-line"));
    assert.exists(await findByTestId("admin-charts-donut"));
    assert.exists(await findByTestId("admin-charts-bar"));
    assert.exists(await findByTestId("admin-charts-area"));
    assert.exists(await findByText("Created vs completed"));
    assert.exists(await findByText("Status mix"));
  });
});
