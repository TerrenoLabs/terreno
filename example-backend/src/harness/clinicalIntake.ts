import {
  defineAgent,
  defineTask,
  type HarnessAgentDefinition,
  type HarnessApprover,
  type HarnessModelRef,
  type HarnessTaskDefinition,
} from "@terreno/ai/harness";
import {APIError, Permissions, z} from "@terreno/api";
import type {DurationLike} from "luxon";

import {access} from "../access";
import {INTAKE_RISK_LEVELS} from "../types/models/fakeEhrTypes";
import {type ChartView, ehr, type NoteContent} from "./fakeEhr";

/** Approval key of the clinician sign-off; selects the approvers below. */
export const CLINICIAN_SIGNOFF = "clinician-signoff";

/**
 * System prompt of `clinic.summarizer`. The user message is the chart as JSON; the answer is
 * the `IntakeSummarySchema` object. Patient data is never part of this constant.
 */
const CLINIC_SUMMARIZER_INSTRUCTIONS = [
  "You summarize a patient chart for the clinician doing the intake review.",
  "The user message is the chart as JSON with problems, medications, allergies, and history.",
  "Write 2-4 plain sentences. Cite the chart section behind each claim in brackets, e.g. [medications].",
  "Set risk to low, moderate, or high from the problems and allergies.",
  "List every section you cited in sources. Never invent findings the chart does not contain.",
].join(" ");

/** The summarizer's structured output: what the clinician signs off and the EHR receives. */
export const IntakeSummarySchema = z
  .object({
    risk: z.enum(INTAKE_RISK_LEVELS),
    sources: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
  })
  .strict();

interface IntakeSummaryInput {
  patientId: string;
}

interface IntakeSummaryState {
  chart?: ChartView;
  /** Id of the user who approved the summary. */
  signedOffBy?: string;
  summary?: NoteContent;
}

interface IntakeSummaryResult {
  /** The filed `FakeClinicalNote` id. */
  noteId?: string;
  /** Why the summary was not filed. */
  reason?: string;
  status: "filed" | "rejected";
}

export interface ClinicalIntake {
  intakeSummary: HarnessTaskDefinition<IntakeSummaryInput, IntakeSummaryState, IntakeSummaryResult>;
  summarizer: HarnessAgentDefinition;
}

/** Approvers are ANDed; this one passes when any of `approvers` passes. */
const anyApprover =
  (...approvers: HarnessApprover[]): HarnessApprover =>
  async (method, user, approval) => {
    for (const approver of approvers) {
      if (await approver(method, user, approval)) {
        return true;
      }
    }
    return false;
  };

/** Admins, or users whose RBAC roles grant `clinicalIntake.signoff` (the `clinician` role). */
const isAdminOrClinician: HarnessApprover = anyApprover(
  Permissions.IsAdmin,
  access.permission({clinicalIntake: ["signoff"]})
);

/** Markdown shown under the approval title in the inbox. */
const signoffSummary = (chart: ChartView, summary: NoteContent): string =>
  [
    `**${chart.name}** (${chart.patientId}), risk **${summary.risk}**`,
    "",
    summary.summary,
    "",
    `Sources: ${summary.sources.join(", ")}`,
  ].join("\n");

const requireState = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new APIError({
      code: "clinic-intake-state-missing",
      detail: `clinic.intakeSummary: ${what} is missing from the task state`,
      status: 500,
      title: "Intake task state is incomplete",
    });
  }
  return value;
};

/**
 * The clinical tracer: fetch the chart (safe) → summarize with an agent (safe) → clinician
 * sign-off (safe) → file the note (default `replay: "never"`). Built per harness because the
 * summarizer's model depends on the server's provider configuration.
 */
export const createClinicalIntake = ({
  fallbackModels = [],
  model,
  signoffTimeout = {hours: 24},
}: {
  fallbackModels?: HarnessModelRef[];
  model: HarnessModelRef;
  /** How long the clinician sign-off waits before it expires (rejected). */
  signoffTimeout?: DurationLike;
}): ClinicalIntake => {
  const summarizer = defineAgent({
    fallbackModels,
    instructions: CLINIC_SUMMARIZER_INSTRUCTIONS,
    model,
    name: "clinic.summarizer",
    tools: [],
  });

  const intakeSummary = defineTask<IntakeSummaryInput, IntakeSummaryState, IntakeSummaryResult>({
    approvals: {[CLINICIAN_SIGNOFF]: {approvers: [isAdminOrClinician]}},
    initial: () => ({phase: "fetch", state: {}}),
    name: "clinic.intakeSummary",
    phases: {
      fetch: {
        replay: "safe",
        run: async (task, rt) => {
          const chart = await ehr.getChart(task.input.patientId);
          if (!chart) {
            await rt.commit({
              terminal: {error: `No chart for patient ${task.input.patientId}`, status: "failed"},
            });
            return;
          }
          await rt.commit({phase: "summarize", state: {chart}});
        },
      },
      review: {
        replay: "safe",
        run: async (task, rt) => {
          const chart = requireState(task.state.chart, "chart");
          const summary = requireState(task.state.summary, "summary");
          const decision = await rt.approval(CLINICIAN_SIGNOFF, {
            payload: {patientId: chart.patientId, ...summary},
            summary: signoffSummary(chart, summary),
            timeout: signoffTimeout,
            title: `Sign off intake summary for ${chart.name}`,
          });
          if (!decision.approved) {
            const reason = decision.expired
              ? "Sign-off expired before anyone decided"
              : (decision.reason ?? "Rejected");
            await rt.commit({
              terminal: {result: {reason, status: "rejected"}, status: "completed"},
            });
            return;
          }
          await rt.commit({
            phase: "write",
            state: {
              ...task.state,
              ...(decision.decidedBy ? {signedOffBy: decision.decidedBy} : {}),
            },
          });
        },
      },
      summarize: {
        replay: "safe",
        run: async (task, rt) => {
          const summary = await rt.runAgent<NoteContent>(summarizer, {
            input: requireState(task.state.chart, "chart"),
            output: IntakeSummarySchema,
          });
          await rt.commit({phase: "review", state: {...task.state, summary}});
        },
      },
      // Default replay ("never"): a write cut off mid-call parks the task `interrupted` for an
      // operator; the idempotency key keeps a retried write to one note.
      write: {
        run: async (task, rt) => {
          rt.signal.throwIfAborted();
          const note = await ehr.writeNote(
            task.input.patientId,
            requireState(task.state.summary, "summary"),
            {
              idempotencyKey: `note-${task.id}`,
              signedOffBy: task.state.signedOffBy,
              taskId: task.id,
            }
          );
          await rt.commit({
            terminal: {result: {noteId: String(note._id), status: "filed"}, status: "completed"},
          });
        },
      },
    },
    retry: {maxAttempts: 3},
    version: 1,
  });

  return {intakeSummary, summarizer};
};
