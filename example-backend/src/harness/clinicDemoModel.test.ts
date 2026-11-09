import {describe, expect, it} from "bun:test";
import {generateText, Output, streamText} from "ai";
import {DateTime} from "luxon";

import {IntakeSummarySchema} from "./clinicalIntake";
import {CLINIC_DEMO_MODEL, createClinicDemoModel, DEMO_SUMMARY_PREFIX} from "./clinicDemoModel";
import type {ChartView} from "./fakeEhr";

const chart = (overrides: Partial<ChartView> = {}): ChartView => ({
  allergies: ["Penicillin (hives)"],
  dateOfBirth: DateTime.now().minus({months: 2, years: 60}).toISODate() ?? "1960-01-01",
  history: "Two weeks of dyspnea.",
  medications: ["Lisinopril 20 mg daily"],
  name: "Avery Synthetic",
  patientId: "p-1",
  problems: ["Hypertension", "Type 2 diabetes"],
  ...overrides,
});

describe("clinic demo model", () => {
  it("answers a chart with the summary schema, citing sections, without a network", async () => {
    const result = await generateText({
      model: createClinicDemoModel(),
      output: Output.object({schema: IntakeSummarySchema}),
      prompt: JSON.stringify(chart()),
    });
    expect(result.output).toEqual({
      risk: "moderate",
      sources: ["problems", "medications", "allergies", "history"],
      summary: `${DEMO_SUMMARY_PREFIX} Avery Synthetic (60y). Problems [problems]: Hypertension; Type 2 diabetes. Medications [medications]: Lisinopril 20 mg daily. Allergies [allergies]: Penicillin (hives). History [history]: Two weeks of dyspnea.`,
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("is deterministic and grades risk from problems and allergies", async () => {
    const model = createClinicDemoModel();
    const ask = async (input: ChartView): Promise<unknown> =>
      (
        await generateText({
          model,
          output: Output.object({schema: IntakeSummarySchema}),
          prompt: JSON.stringify(input),
        })
      ).output;
    const high = chart({problems: ["A", "B", "C"]});
    expect(await ask(high)).toEqual(await ask(high));
    expect(await ask(high)).toMatchObject({risk: "high"});
    expect(await ask(chart({allergies: [], history: "", problems: []}))).toMatchObject({
      risk: "low",
      sources: ["problems", "medications", "allergies"],
    });
    expect(await ask(chart({dateOfBirth: "not a date"}))).toMatchObject({
      summary: expect.stringContaining("(age unknown)"),
    });
  });

  it("labels a reply to anything that is not a chart", async () => {
    for (const prompt of ["Summarize patient p7", '{"name": 3}', "[1, 2]"]) {
      const result = await generateText({model: createClinicDemoModel(), prompt});
      expect(result.text).toBe(
        `${DEMO_SUMMARY_PREFIX} Received ${prompt.length} characters that are not a patient chart.`
      );
    }
  });

  it("streams the same answer", async () => {
    const streamed = streamText({model: createClinicDemoModel(), prompt: JSON.stringify(chart())});
    const text = await streamed.text;
    expect(JSON.parse(text)).toMatchObject({risk: "moderate"});
    expect((await streamed.usage).outputTokens).toBeGreaterThan(0);
  });

  it("names itself demo/clinic-summarizer-demo", () => {
    const model = createClinicDemoModel();
    expect(typeof model === "object" && `${model.provider}/${model.modelId}`).toBe(
      `${CLINIC_DEMO_MODEL.provider}/${CLINIC_DEMO_MODEL.modelId}`
    );
  });

  it("waits CLINIC_DEMO_MODEL_DELAY_MS before answering and stops when aborted", async () => {
    process.env.CLINIC_DEMO_MODEL_DELAY_MS = "150";
    const started = DateTime.now();
    await generateText({model: createClinicDemoModel(), prompt: "hello"});
    expect(DateTime.now().diff(started).milliseconds).toBeGreaterThanOrEqual(140);

    process.env.CLINIC_DEMO_MODEL_DELAY_MS = "60000";
    const controller = new AbortController();
    const pending = generateText({
      abortSignal: controller.signal,
      maxRetries: 0,
      model: createClinicDemoModel(),
      prompt: "hello",
    });
    const aborted = DateTime.now();
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(DateTime.now().diff(aborted).milliseconds).toBeLessThan(1000);
  });

  it("ignores an invalid delay", async () => {
    process.env.CLINIC_DEMO_MODEL_DELAY_MS = "soon";
    const started = DateTime.now();
    await generateText({model: createClinicDemoModel(), prompt: "hello"});
    expect(DateTime.now().diff(started).milliseconds).toBeLessThan(1000);
  });
});
