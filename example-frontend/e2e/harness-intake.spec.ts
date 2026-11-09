import path from "node:path";
import type {APIRequestContext, Page, TestInfo} from "@playwright/test";
import {DateTime} from "luxon";
import {type Db, MongoClient, ObjectId} from "mongodb";
import {expect, test} from "./fixtures/test";
import {getAdminToken, loginAsAdmin} from "./helpers/adminAuth";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1/terreno-e2e";

interface ApprovalRow {
  _id: string;
  id?: string;
  taskId: string;
  title: string;
}

interface SpanNode {
  children: SpanNode[];
  id: string;
  kind: string;
  name: string;
  output?: Record<string, unknown>;
  status: string;
}

/** Saves a screenshot to `HARNESS_E2E_ARTIFACTS_DIR` when set, else the test output dir. */
const capture = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const dir = process.env.HARNESS_E2E_ARTIFACTS_DIR;
  const file = dir
    ? path.join(dir, `harness-intake-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  await page.screenshot({fullPage: true, path: file});
};

const withDb = async <T>(use: (db: Db) => Promise<T>): Promise<T> => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    return await use(client.db());
  } finally {
    await client.close();
  }
};

/** A synthetic chart in the fake EHR, unique to this run (e2e runs do not `bun run seed`). */
const insertChart = async (patientId: string, name: string): Promise<void> => {
  const now = DateTime.now().toJSDate();
  await withDb((db) =>
    db.collection("fakepatientcharts").insertOne({
      allergies: ["Penicillin (hives)"],
      created: now,
      dateOfBirth: "1958-04-12",
      deleted: false,
      history: "Two weeks of exertional dyspnea.",
      medications: ["Lisinopril 20 mg daily"],
      name,
      patientId,
      problems: ["Hypertension", "Type 2 diabetes"],
      updated: now,
    })
  );
};

/** Start a run through the `startClinicalIntake` admin script and wait for its sign-off. */
const startIntake = async (
  request: APIRequestContext,
  {name, patientId}: {name: string; patientId: string}
): Promise<ApprovalRow> => {
  const headers = {authorization: `Bearer ${await getAdminToken(request)}`};
  const run = await request.post(`${API_URL}/admin/scripts/startClinicalIntake/run?wetRun=true`, {
    data: {patientId, requestId: `e2e-${patientId}`},
    headers,
  });
  expect(run.ok(), await run.text()).toBe(true);

  let mine: ApprovalRow | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/harness/approvals?limit=100`, {headers});
        const body = (await res.json()) as {data?: ApprovalRow[]};
        mine = (body.data ?? []).find((approval) => approval.title.endsWith(name));
        return Boolean(mine);
      },
      {timeout: 60_000}
    )
    .toBe(true);
  if (!mine) {
    throw new Error("approval not found");
  }
  return mine;
};

/** The task row once the runner finished the `write` phase. */
const waitForFiled = async (
  taskId: string
): Promise<{result: {noteId?: string; status: string}; traceId: string}> => {
  let found: {result: {noteId?: string; status: string}; traceId: string} | undefined;
  await expect
    .poll(
      async () => {
        const task = await withDb((db) =>
          db.collection("harnesstasks").findOne({_id: new ObjectId(taskId)})
        );
        if (task?.status === "completed") {
          found = {result: task.outcome?.result, traceId: String(task.traceId)};
        }
        return task?.status;
      },
      {timeout: 60_000}
    )
    .toBe("completed");
  if (!found) {
    throw new Error("task did not complete");
  }
  return found;
};

const flatten = (nodes: SpanNode[], parent?: string): Array<SpanNode & {parent?: string}> =>
  nodes.flatMap((node) => [{...node, parent}, ...flatten(node.children, node.name)]);

test.describe("Clinical intake tracer", () => {
  test("approves the summary in the inbox, files one note, and shows the span tree", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const stamp = DateTime.now().toMillis();
    const patientId = `e2e-${stamp}`;
    const name = `E2E Patient ${stamp}`;
    await insertChart(patientId, name);
    const approval = await startIntake(request, {name, patientId});
    const approvalId = approval.id ?? approval._id;

    await loginAsAdmin(page);
    await page.goto("/admin/harness-approvals");
    const row = page.getByTestId(`harness-approval-row-${approvalId}-clickable`);
    await expect(row).toBeVisible({timeout: 30_000});
    await expect(row).toContainText("clinic.intakeSummary@1");
    await row.click();
    await expect(page.getByTestId("harness-approval-detail")).toBeVisible();
    await expect(page.getByText(`Sign off intake summary for ${name}`).first()).toBeVisible();
    await expect(page.getByTestId("harness-approval-payload")).toContainText(
      "[Demo model: no LLM was called]"
    );
    await capture(page, testInfo, "inbox-detail");
    await page.getByTestId("harness-approval-approve").click();
    await expect(page.getByTestId("harness-approvals-notice")).toContainText("Approved");

    const {result, traceId} = await waitForFiled(approval.taskId);
    expect(result.status).toBe("filed");
    const notes = await withDb((db) =>
      db
        .collection("fakeclinicalnotes")
        .find({idempotencyKey: `note-${approval.taskId}`})
        .toArray()
    );
    expect(notes).toHaveLength(1);
    expect(String(notes[0]._id)).toBe(result.noteId);

    // The span tree, through the observability trace API the admin Traces screen reads.
    const headers = {authorization: `Bearer ${await getAdminToken(request)}`};
    const traceRes = await request.get(`${API_URL}/ai/observability/traces/${traceId}`, {headers});
    expect(traceRes.ok(), await traceRes.text()).toBe(true);
    const trace = (await traceRes.json()) as {data: {name: string; spans: SpanNode[]}};
    expect(trace.data.name).toBe("clinic.intakeSummary@1");
    const spans = flatten(trace.data.spans);
    const named = (spanName: string) => spans.filter((span) => span.name === spanName);
    expect(spans[0]).toMatchObject({kind: "CHAIN", name: "clinic.intakeSummary@1"});
    for (const phase of ["fetch", "summarize", "review", "write"]) {
      expect(named(phase).length, phase).toBeGreaterThan(0);
      expect(named(phase).every((span) => span.kind === "CHAIN")).toBe(true);
    }
    const agent = named("clinic.summarizer");
    expect(agent).toEqual([expect.objectContaining({kind: "AGENT", status: "ok"})]);
    expect(named("demo/clinic-summarizer-demo")).toEqual([
      expect.objectContaining({kind: "LLM", parent: "clinic.summarizer"}),
    ]);
    const decision = named("approval:clinician-signoff");
    expect(decision).toEqual([
      expect.objectContaining({
        kind: "CHAIN",
        output: expect.objectContaining({decision: "approved"}),
      }),
    ]);

    await page.goto(`/admin/ai-trace-detail?id=${traceId}`);
    await expect(page.getByTestId("ai-trace-detail")).toBeVisible({timeout: 30_000});
    await expect(page.getByTestId(`ai-trace-span-${agent[0].id}-clickable`)).toBeVisible();
    await expect(page.getByTestId(`ai-trace-span-${decision[0].id}-clickable`)).toBeVisible();
    await capture(page, testInfo, "trace-waterfall");
  });
});
