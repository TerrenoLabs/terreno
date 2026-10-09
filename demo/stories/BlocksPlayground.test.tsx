import {beforeAll, describe, expect, it} from "bun:test";
import {IconButton, SelectField, TerrenoProvider} from "@terreno/ui";
import {act, fireEvent, render} from "@testing-library/react-native";

import {BlocksPlaygroundDemo} from "./BlocksPlayground.stories";
import type {PresetName} from "./blocksPlaygroundPresets";

// Some block renderers load lazily, so the first render settles before the test looks.
const renderPlayground = async (initialPreset: PresetName): Promise<ReturnType<typeof render>> => {
  const view = render(<BlocksPlaygroundDemo initialPreset={initialPreset} />, {
    wrapper: TerrenoProvider,
  });
  await view.findByTestId("blocks-playground");
  return view;
};

const settle = async (work: () => unknown): Promise<void> => {
  await act(async () => {
    await work();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};

interface RafGlobal {
  cancelAnimationFrame?: (id: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

describe("BlocksPlayground Sunday roast", () => {
  // The toast host schedules its show on the next frame.
  beforeAll(() => {
    const g = globalThis as RafGlobal;
    if (!g.requestAnimationFrame) {
      g.requestAnimationFrame = (callback) =>
        setTimeout(() => callback(Date.now()), 0) as unknown as number;
      g.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  });

  it("scales the shopping list on + without a server and shows a toast", async () => {
    const view = await renderPlayground("Sunday roast");
    expect(view.getByText("2.0 kg")).toBeTruthy();
    // bunSetup replaces IconButton with a null mock, so the button is found by its props.
    const increase = view
      .UNSAFE_getAllByType(IconButton)
      .find((node) => node.props.accessibilityLabel === "Increase Number of people");
    await settle(() => increase?.props.onClick());
    expect(String(view.getByTestId("blocks-8-0-value").props.children)).toBe("6");
    expect(view.getByText("2.4 kg")).toBeTruthy();
    expect(view.getByText("scaleStepper → 6 People")).toBeTruthy();
  });

  it("ticks a checklist item without a server and shows a toast", async () => {
    const view = await renderPlayground("Sunday roast");
    const counter = (): string => String(view.getByTestId("blocks-13-counter").props.children);
    expect(counter()).toBe("1 of 8");
    await settle(() =>
      fireEvent.press(view.getByTestId("blocks-13-cooking_prepare_lamb-row-clickable"))
    );
    expect(counter()).toBe("2 of 8");
    expect(view.getByText("toggleChecklist → 2 of 8")).toBeTruthy();
  });

  it("shows the reply a follow-up button would send", async () => {
    const view = await renderPlayground("Sunday roast");
    await settle(() => fireEvent.press(view.getByText("Adjust the plan for 5 guests")));
    expect(view.getByText('Reply: "Help me adjust the lamb roast plan for 5 guests"')).toBeTruthy();
  });

  it("clears the block type picker when a preset button loads another document", async () => {
    const view = await renderPlayground("Sunday roast");
    const picker = (): {props: {onChange: (value: string) => void; value: string}} =>
      view.UNSAFE_getByType(SelectField);
    await settle(() => picker().props.onChange("gallery"));
    expect(picker().props.value).toBe("gallery");
    await settle(() => fireEvent.press(view.getByTestId("blocks-playground-preset-layout")));
    expect(picker().props.value).toBe("");
  });
});
