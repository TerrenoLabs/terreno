import {describe, expect, it, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import type React from "react";
import {Text as RNText} from "react-native";
import {Gesture} from "react-native-gesture-handler";

import {DraggableList} from "../../src/DraggableList";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

const ids = Array.from({length: 8}, (_, index) => `row-${index}`);
const ItemLabel = ({item}: {item: string}): React.ReactElement => <RNText>{item}</RNText>;
const renderItem = ({item}: {item: string}): React.ReactElement => <ItemLabel item={item} />;
const callbackNewDataIds = (): void => {};
const layout = (height: number): {nativeEvent: {layout: Record<string, number>}} => ({
  nativeEvent: {layout: {height, width: 100, x: 0, y: 0}},
});

interface PanEvent {
  translationY: number;
}

interface CapturedGesture {
  onBegin?: () => void;
  onChange?: (event: PanEvent) => void;
  onFinalize?: () => void;
}

let capturedGestures: CapturedGesture[] = [];

/** Replaces Gesture.Pan with a chainable stub that records the registered handlers. */
const capturePanGestures = (): ReturnType<typeof spyOn> => {
  return spyOn(Gesture, "Pan").mockImplementation(() => {
    const captured: CapturedGesture = {};
    capturedGestures.push(captured);
    const chainable = {
      onBegin: (handler: () => void) => {
        captured.onBegin = handler;
        return chainable;
      },
      onChange: (handler: (event: PanEvent) => void) => {
        captured.onChange = handler;
        return chainable;
      },
      onFinalize: (handler: () => void) => {
        captured.onFinalize = handler;
        return chainable;
      },
    };
    return chainable as unknown as ReturnType<typeof Gesture.Pan>;
  });
};

/** The newest gesture registered for the row at `index` of an 8-row list. */
const gestureForRow = (index: number): CapturedGesture | undefined => {
  return capturedGestures.at(index - ids.length);
};

for (const variableHeight of [false, true]) {
  describe(`DraggableList renders (variableHeight=${variableHeight})`, () => {
    it("does not re-render row content when rows are measured or dragged", async () => {
      capturedGestures = [];
      const panSpy = capturePanGestures();
      const baseline = {callbackNewDataIds, dataIDs: ids, renderItem, variableHeight};
      const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
      const view = await audit.step("mount", () =>
        renderWithTheme(<DraggableList {...baseline} />)
      );
      await audit.step("same props", () => view.rerender(<DraggableList {...baseline} />));
      await audit.step("new equal dataIDs", () =>
        view.rerender(<DraggableList {...baseline} dataIDs={[...ids]} />)
      );
      view.rerender(<DraggableList {...baseline} />);
      await audit.step("new callback identity", () =>
        view.rerender(<DraggableList {...baseline} callbackNewDataIds={(): void => {}} />)
      );
      view.rerender(<DraggableList {...baseline} />);
      await audit.step("new renderItem identity", () =>
        view.rerender(
          <DraggableList
            {...baseline}
            renderItem={({item}: {item: string}): React.ReactElement => <ItemLabel item={item} />}
          />
        )
      );
      view.rerender(<DraggableList {...baseline} />);
      if (variableHeight) {
        await audit.step("measure 8 rows", async () => {
          for (const id of ids) {
            await act(async () => {
              fireEvent(view.getByTestId(`draggable-item-${id}`), "layout", layout(40));
            });
          }
        });
        await audit.step("one row grows", async () => {
          await act(async () => {
            fireEvent(view.getByTestId("draggable-item-row-2"), "layout", layout(120));
          });
        });
      }
      await audit.step("drag begin", async () => {
        await act(async () => {
          gestureForRow(1)?.onBegin?.();
        });
      });
      await audit.step("drag past two rows", async () => {
        await act(async () => {
          gestureForRow(1)?.onChange?.({translationY: 250});
        });
      });
      await audit.step("drag end", async () => {
        await act(async () => {
          gestureForRow(1)?.onFinalize?.();
        });
      });
      panSpy.mockRestore();
      const report = audit.report();
      audit.dispose();
      view.unmount();
      if (process.env.RENDER_AUDIT_PRINT) {
        console.info(`\n## DraggableList ${variableHeight}\n${formatReport(report, {limit: 12})}`);
      }

      expect(componentStat(report, "mount", "DragItemContent")?.mounts).toBe(ids.length);
      expect(componentStat(report, "new renderItem identity", "DragItemContent")?.updates).toBe(
        ids.length
      );
      const quietSteps = ["same props", "new equal dataIDs", "new callback identity", "drag begin"];
      if (variableHeight) {
        quietSteps.push("measure 8 rows", "one row grows", "drag past two rows", "drag end");
      }
      for (const step of quietSteps) {
        expect(componentStat(report, step, "DragItemContent")).toBeUndefined();
        expect(componentStat(report, step, "ItemLabel")).toBeUndefined();
      }
    });
  });
}
