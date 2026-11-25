/**
 * Render audit for a running web page, driven through Playwright.
 *
 *   const audit = await attachRenderAudit({page});      // before page.goto
 *   await page.goto(url);
 *   await page.getByTestId("todos-screen").waitFor({state: "visible"});
 *   await audit.endLoad();
 *   await audit.step("type in search", async () => { ... });
 *   const report = await audit.report();
 *
 * Use a development or unminified build: a minified bundle renames every component.
 */
import {join} from "node:path";

import type {AuditReport, StepReport} from "./renderAudit";

/** The two Playwright `Page` methods the audit needs. */
export interface AuditablePage {
  addInitScript: (script: {content: string}) => Promise<unknown>;
  evaluate: <Result>(expression: string) => Promise<Result>;
}

export interface AttachRenderAuditOptions {
  page: AuditablePage;
  /** Count only components whose display name matches. */
  only?: RegExp;
  /** Skip components whose display name matches. */
  ignore?: RegExp;
  /** Label for the step that covers navigation and first paint. */
  loadLabel?: string;
}

export interface PageRenderAudit {
  /** Close the load step once the page has settled. */
  endLoad: () => Promise<StepReport>;
  step: <Result>(label: string, run: () => Promise<Result>) => Promise<Result>;
  report: () => Promise<AuditReport>;
}

const AUDIT = "globalThis.__RENDER_AUDIT__";

const buildCollector = async (): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "pageAuditEntry.ts")],
    format: "iife",
    target: "browser",
  });
  if (!result.success) {
    throw new Error(`pageAudit: collector build failed: ${result.logs.join("\n")}`);
  }
  return result.outputs[0].text();
};

export const attachRenderAudit = async ({
  page,
  only,
  ignore,
  loadLabel = "load",
}: AttachRenderAuditOptions): Promise<PageRenderAudit> => {
  const options = {ignore: ignore?.source, loadLabel, only: only?.source};
  const collector = await buildCollector();
  await page.addInitScript({
    content: `globalThis.__RENDER_AUDIT_OPTIONS__ = ${JSON.stringify(options)};\n${collector}`,
  });

  const step = async <Result>(label: string, run: () => Promise<Result>): Promise<Result> => {
    await page.evaluate(`${AUDIT}.begin(${JSON.stringify(label)})`);
    try {
      return await run();
    } finally {
      await page.evaluate(`${AUDIT}.end()`);
    }
  };

  return {
    endLoad: (): Promise<StepReport> => page.evaluate<StepReport>(`${AUDIT}.end()`),
    report: (): Promise<AuditReport> => page.evaluate<AuditReport>(`${AUDIT}.report()`),
    step,
  };
};
