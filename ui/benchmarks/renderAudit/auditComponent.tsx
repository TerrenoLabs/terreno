import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {FC} from "react";

import {renderWithTheme} from "../../src/test-utils";
import {type AuditReport, auditPropChanges, createRenderAudit, formatReport} from "./renderAudit";

interface AuditComponentOptions<Props extends object> {
  baseline: Props;
  /** Step label → the props to switch to. Each step starts from `baseline`. */
  changes: Record<string, Props>;
  Component: FC<Props>;
  name: string;
}

// The test wrapper re-renders on every `rerender` call; it is harness noise, not the component.
const HARNESS_WRAPPERS = /^(ThemeProvider|TerrenoFontProvider)$/;

/**
 * Runs the standard prop matrix against one component and returns the render report.
 * `RENDER_AUDIT_OUT=<dir>` also writes `<dir>/<name>.json` for `compareAudits.ts`, and
 * `RENDER_AUDIT_PRINT=1` prints the per-step tables.
 */
export const auditComponent = async <Props extends object>({
  baseline,
  changes,
  Component,
  name,
}: AuditComponentOptions<Props>): Promise<AuditReport> => {
  const audit = createRenderAudit({ignore: HARNESS_WRAPPERS});
  let view: ReturnType<typeof renderWithTheme> | undefined;
  await auditPropChanges({
    audit,
    baseline,
    changes,
    mount: (props): void => {
      view = renderWithTheme(<Component {...props} />);
    },
    update: (props): void => {
      view?.rerender(<Component {...props} />);
    },
  });
  const report = audit.report();
  audit.dispose();
  view?.unmount();

  if (process.env.RENDER_AUDIT_PRINT) {
    console.info(`\n## ${name}\n${formatReport(report)}`);
  }
  const outDir = process.env.RENDER_AUDIT_OUT;
  if (outDir) {
    mkdirSync(outDir, {recursive: true});
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 2));
  }
  return report;
};
