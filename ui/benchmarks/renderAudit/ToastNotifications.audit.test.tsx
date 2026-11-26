import {describe, expect, it} from "bun:test";
import {act} from "@testing-library/react-native";
import type {ReactElement} from "react";
import {Text} from "react-native";

import {Toast} from "../../src/Toast";
import {
  type ToastProps,
  ToastProvider,
  type ToastType,
  useToastNotifications,
} from "../../src/ToastNotifications";
import {renderWithTheme} from "../../src/test-utils";
import {componentStat, createRenderAudit, formatReport} from "./renderAudit";

let toast: ToastType | undefined;
const onDismiss = (): void => {};
const Capture = (): ReactElement => {
  toast = useToastNotifications();
  return <Text>App</Text>;
};
const renderToast = (options: ToastProps): ReactElement => (
  <Toast title={String(options.message)} {...options.data} />
);
const app = <Capture />;
const tick = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe("ToastNotifications renders", () => {
  it("re-renders only the toast that was shown or hidden", async () => {
    global.requestAnimationFrame = ((callback: FrameRequestCallback): number =>
      setTimeout(() => callback(0), 0) as unknown as number) as typeof requestAnimationFrame;
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const tree = (): ReactElement => (
      <ToastProvider animationDuration={0} placement="bottom" renderToast={renderToast}>
        {app}
      </ToastProvider>
    );
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      view = renderWithTheme(tree());
      await tick();
    });
    await audit.step("show 8 toasts", async () => {
      for (let index = 0; index < 8; index++) {
        toast?.show(`Toast ${index}`, {
          data: {onDismiss, persistent: true},
          duration: 0,
          id: `t${index}`,
        });
        await tick();
      }
    });
    await audit.step("parent re-render", async () => {
      view?.rerender(tree());
      await tick();
    });
    await audit.step("show one more", async () => {
      toast?.show("Another", {data: {onDismiss, persistent: true}, duration: 0, id: "t8"});
      await tick();
    });
    await audit.step("hide one", async () => {
      toast?.hide("t3");
      await tick();
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 8}));
    }

    expect(componentStat(report, "show 8 toasts", "ToastItem")?.mounts).toBe(8);
    expect(componentStat(report, "show 8 toasts", "ToastItem")?.updates).toBe(0);
    expect(componentStat(report, "parent re-render", "ToastItem")).toBeUndefined();
    expect(componentStat(report, "show one more", "ToastItem")?.updates).toBe(0);
    expect(componentStat(report, "hide one", "ToastItem")?.updates).toBe(1);
  });
});
