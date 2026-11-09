import {defineTask} from "@terreno/ai/harness";
import {Permissions} from "@terreno/api";

/** Approval key the demo asks for; selects the approvers policy below. */
const APPROVAL_DEMO_KEY = "demo-signoff";

export interface ApprovalDemoInput {
  /** Shown as the approval title in the inbox. */
  title: string;
  /** Free-form data the approver reviews (rendered as JSON). */
  payload?: Record<string, unknown>;
}

export interface ApprovalDemoResult {
  decidedBy?: string;
  reason?: string;
  status: "approved" | "expired" | "rejected";
}

const DEMO_SUMMARY = [
  "A demo harness task is waiting on this decision.",
  "",
  "- **Approve** completes the task with `status: approved`.",
  "- **Reject** completes it with `status: rejected` and your reason.",
].join("\n");

/**
 * Smallest durable workflow that needs a human: one `replay: "safe"` phase asks for an
 * approval, then completes with the decision. Admins approve it in the admin
 * "AI Harness → Approvals" inbox. The full worked example is `clinic.intakeSummary`
 * (`clinicalIntake.ts`); this one stays as the inbox's approve/reject fixture.
 */
export const approvalDemo = defineTask<
  ApprovalDemoInput,
  Record<string, never>,
  ApprovalDemoResult
>({
  approvals: {[APPROVAL_DEMO_KEY]: {approvers: [Permissions.IsAdmin]}},
  initial: () => ({phase: "review", state: {}}),
  name: "demo.approvalDemo",
  phases: {
    review: {
      replay: "safe",
      run: async (task, rt) => {
        const decision = await rt.approval(APPROVAL_DEMO_KEY, {
          payload: task.input.payload ?? {},
          summary: DEMO_SUMMARY,
          title: task.input.title,
        });
        const status = decision.approved ? "approved" : decision.expired ? "expired" : "rejected";
        await rt.commit({
          terminal: {
            result: {
              status,
              ...(decision.decidedBy ? {decidedBy: decision.decidedBy} : {}),
              ...(decision.reason ? {reason: decision.reason} : {}),
            },
            status: "completed",
          },
        });
      },
    },
  },
  version: 1,
});
