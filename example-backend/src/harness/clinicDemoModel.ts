import type {HarnessModelRef} from "@terreno/ai/harness";
import {logger} from "@terreno/api";
import type {LanguageModel} from "ai";
import {DateTime} from "luxon";

import type {ChartView, NoteContent} from "./fakeEhr";

/** The AI SDK's LanguageModelV2 object shape, derived from `ai` so no extra dependency is needed. */
type LanguageModelV2Like = Extract<LanguageModel, {specificationVersion: "v2"}>;
type DemoCallOptions = Parameters<LanguageModelV2Like["doGenerate"]>[0];
type DemoGenerateResult = Awaited<ReturnType<LanguageModelV2Like["doGenerate"]>>;
type DemoStreamResult = Awaited<ReturnType<LanguageModelV2Like["doStream"]>>;

/**
 * Model reference of the deterministic demo summarizer. LLM spans name it
 * `demo/clinic-summarizer-demo`, so a trace never passes the demo off as a real model.
 */
export const CLINIC_DEMO_MODEL: HarnessModelRef = {
  modelId: "clinic-summarizer-demo",
  provider: "demo",
};

/** Prefix on every demo summary, so the inbox shows that no LLM wrote it. */
export const DEMO_SUMMARY_PREFIX = "[Demo model: no LLM was called]";

/**
 * `CLINIC_DEMO_MODEL_DELAY_MS`: how long each demo request waits before answering (default
 * 0). Read on every request, so a test can hold the `summarize` phase open and kill the
 * process mid-request.
 */
const demoDelayMs = (): number => {
  const raw = Number(process.env.CLINIC_DEMO_MODEL_DELAY_MS ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

const waitFor = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Demo model request aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Demo model request aborted"));
      },
      {once: true}
    );
  });
};

/** The last user message's text: the chart JSON `rt.runAgent` sent. */
const lastUserText = (options: DemoCallOptions): string => {
  const user = [...options.prompt].reverse().find((message) => message.role === "user");
  if (user?.role !== "user") {
    return "";
  }
  return user.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
};

const isChartView = (value: unknown): value is ChartView => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const chart = value as Partial<ChartView>;
  return (
    typeof chart.name === "string" &&
    Array.isArray(chart.problems) &&
    Array.isArray(chart.medications) &&
    Array.isArray(chart.allergies)
  );
};

const parseChart = (text: string): ChartView | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isChartView(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const listOrNone = (items: string[]): string => (items.length > 0 ? items.join("; ") : "none");

const ageOn = (dateOfBirth: string): string => {
  const born = DateTime.fromISO(dateOfBirth);
  if (!born.isValid) {
    return "age unknown";
  }
  return `${Math.floor(DateTime.now().diff(born, "years").years)}y`;
};

/** Deterministic rule standing in for clinical judgment: more findings, higher risk. */
const riskFor = (chart: ChartView): NoteContent["risk"] => {
  const findings = chart.problems.length + (chart.allergies.length > 0 ? 1 : 0);
  if (findings >= 4) {
    return "high";
  }
  return findings >= 2 ? "moderate" : "low";
};

/** The summary the demo model returns for a chart, as the summarizer's structured output. */
const demoSummaryFor = (chart: ChartView): NoteContent => {
  const sources = ["problems", "medications", "allergies"];
  if (chart.history.trim()) {
    sources.push("history");
  }
  return {
    risk: riskFor(chart),
    sources,
    summary: [
      `${DEMO_SUMMARY_PREFIX} ${chart.name} (${ageOn(chart.dateOfBirth)}).`,
      `Problems [problems]: ${listOrNone(chart.problems)}.`,
      `Medications [medications]: ${listOrNone(chart.medications)}.`,
      `Allergies [allergies]: ${listOrNone(chart.allergies)}.`,
      ...(chart.history.trim() ? [`History [history]: ${chart.history.trim()}`] : []),
    ].join(" "),
  };
};

const answerFor = (options: DemoCallOptions): string => {
  const input = lastUserText(options);
  const chart = parseChart(input);
  if (!chart) {
    return `${DEMO_SUMMARY_PREFIX} Received ${input.length} characters that are not a patient chart.`;
  }
  return JSON.stringify(demoSummaryFor(chart));
};

/** Rough token counts (4 characters per token), so spans show non-zero usage. */
const usageFor = (
  options: DemoCallOptions,
  text: string
): {inputTokens: number; outputTokens: number; totalTokens: number} => {
  const inputTokens = Math.ceil(JSON.stringify(options.prompt).length / 4);
  const outputTokens = Math.ceil(text.length / 4);
  return {inputTokens, outputTokens, totalTokens: inputTokens + outputTokens};
};

const generate = async (options: DemoCallOptions): Promise<DemoGenerateResult> => {
  const delayMs = demoDelayMs();
  if (delayMs > 0) {
    logger.info(`[clinic-demo] holding request for ${delayMs} ms`);
  }
  await waitFor(delayMs, options.abortSignal);
  const text = answerFor(options);
  return {
    content: [{text, type: "text"}],
    finishReason: "stop",
    usage: usageFor(options, text),
    warnings: [],
  };
};

const stream = async (options: DemoCallOptions): Promise<DemoStreamResult> => {
  const result = await generate(options);
  const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({type: "stream-start", warnings: []});
        controller.enqueue({id: "demo-text", type: "text-start"});
        controller.enqueue({delta: text, id: "demo-text", type: "text-delta"});
        controller.enqueue({id: "demo-text", type: "text-end"});
        controller.enqueue({finishReason: "stop", type: "finish", usage: result.usage});
        controller.close();
      },
    }),
  };
};

/**
 * A deterministic, local `LanguageModel` for dev and e2e runs without provider credentials.
 * Given a chart (the JSON user message from `rt.runAgent`), it answers with the
 * `IntakeSummarySchema` JSON derived from the chart by fixed rules; anything else gets a
 * one-line labeled reply. Never calls a network.
 */
export const createClinicDemoModel = (): LanguageModel => {
  const model: LanguageModelV2Like = {
    doGenerate: generate,
    doStream: stream,
    modelId: CLINIC_DEMO_MODEL.modelId,
    provider: CLINIC_DEMO_MODEL.provider,
    specificationVersion: "v2",
    supportedUrls: {},
  };
  return model;
};
