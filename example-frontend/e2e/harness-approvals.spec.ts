import path from "node:path";
import type {APIRequestContext, Page, TestInfo} from "@playwright/test";
import {DateTime} from "luxon";
import {MongoClient, ObjectId} from "mongodb";
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

/** Saves a screenshot to `HARNESS_E2E_ARTIFACTS_DIR` when set, else the test output dir. */
const capture = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const dir = process.env.HARNESS_E2E_ARTIFACTS_DIR;
  const file = dir
    ? path.join(dir, `harness-approvals-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  await page.screenshot({fullPage: true, path: file});
};

/** Start two `demo.approvalDemo` tasks through the admin script and wait for their approvals. */
const startDemoApprovals = async (
  request: APIRequestContext,
  prefix: string
): Promise<ApprovalRow[]> => {
  const token = await getAdminToken(request);
  const headers = {authorization: `Bearer ${token}`};
  const run = await request.post(
    `${API_URL}/admin/scripts/startHarnessApprovalDemo/run?wetRun=true`,
    {data: {count: 2, prefix}, headers}
  );
  expect(run.ok(), await run.text()).toBe(true);

  let mine: ApprovalRow[] = [];
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/harness/approvals?limit=100`, {headers});
        const body = (await res.json()) as {data?: ApprovalRow[]};
        mine = (body.data ?? []).filter((approval) => approval.title.startsWith(prefix));
        return mine.length;
      },
      {timeout: 30_000}
    )
    .toBe(2);
  return mine;
};

/** The demo task's terminal result once the runner resumes it after the decision. */
const waitForTaskResult = async (taskId: string): Promise<{reason?: string; status: string}> => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const tasks = client.db().collection("harnesstasks");
    let result: {reason?: string; status: string} | undefined;
    await expect
      .poll(
        async () => {
          const task = await tasks.findOne({_id: new ObjectId(taskId)});
          result = task?.status === "completed" ? task.outcome?.result : undefined;
          return task?.status;
        },
        {timeout: 30_000}
      )
      .toBe("completed");
    return result ?? {status: "missing"};
  } finally {
    await client.close();
  }
};

test.describe("Harness approvals inbox", () => {
  test("approves one item and rejects one with a reason", async ({page, request}, testInfo) => {
    const prefix = `E2E approval ${DateTime.now().toMillis()}`;
    const [first, second] = await startDemoApprovals(request, prefix);
    const firstId = first.id ?? first._id;
    const secondId = second.id ?? second._id;

    await loginAsAdmin(page);
    await page.goto("/admin/harness-approvals");
    const firstRow = page.getByTestId(`harness-approval-row-${firstId}-clickable`);
    const secondRow = page.getByTestId(`harness-approval-row-${secondId}-clickable`);
    await expect(firstRow).toBeVisible({timeout: 30_000});
    await expect(secondRow).toBeVisible();
    await expect(firstRow).toContainText("demo.approvalDemo@1");
    await capture(page, testInfo, "list");

    await firstRow.click();
    await expect(page.getByTestId("harness-approval-detail")).toBeVisible();
    await expect(page.getByText("A demo harness task is waiting on this decision.")).toBeVisible();
    await expect(page.getByTestId("harness-approval-payload")).toContainText(
      "startHarnessApprovalDemo"
    );
    await capture(page, testInfo, "detail");
    await page.getByTestId("harness-approval-approve").click();
    await expect(page.getByTestId("harness-approvals-notice")).toContainText("Approved");
    await expect(firstRow).toHaveCount(0);
    await capture(page, testInfo, "approved");
    expect(await waitForTaskResult(first.taskId)).toMatchObject({status: "approved"});

    // The page back chevron closes the detail and stays on the inbox.
    await secondRow.click();
    await expect(page.getByTestId("harness-approval-back")).toHaveCount(0);
    // `last`: the admin stack header has its own Back button before the page chevron.
    await page.getByLabel("Back").last().click();
    await expect(secondRow).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/harness-approvals/);

    await secondRow.click();
    await page.getByTestId("harness-approval-reject").click();
    await expect(page.getByText("A reason is required to reject.")).toBeVisible();
    await capture(page, testInfo, "reject-validation");
    await page.getByTestId("harness-approval-reason").fill("Wrong patient on the chart");
    await page.getByTestId("harness-approval-reject").click();
    await expect(page.getByTestId("harness-approvals-notice")).toContainText("Rejected");
    await expect(secondRow).toHaveCount(0);
    await capture(page, testInfo, "rejected");
    expect(await waitForTaskResult(second.taskId)).toEqual(
      expect.objectContaining({reason: "Wrong patient on the chart", status: "rejected"})
    );
  });
});
