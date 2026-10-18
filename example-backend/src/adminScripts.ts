import type {AdminScriptConfig} from "@terreno/admin-backend";
import {
  ConsentForm,
  ConsentResponse,
  createAuditEventModel,
  type ScriptContext,
  type ScriptResult,
  syncConsents,
} from "@terreno/api";
import {FeatureFlag} from "@terreno/feature-flags";
import {getJobsService} from "@terreno/jobs";
import mongoose from "mongoose";

import {consentDefinitions} from "./consentDefinitions";
import {startApprovalDemo} from "./harness/startApprovalDemo";
import {DEFAULT_INTAKE_PATIENT_ID, startClinicalIntake} from "./harness/startClinicalIntake";
import {Project} from "./models/project";
import {Todo} from "./models/todo";
import {User} from "./models/user";
import {seedChatSafetyDataset} from "./scripts/chatSafetyDataset";
import {seedFeatureFlags} from "./scripts/seed-feature-flags";
import {seedDefaultData} from "./scripts/seed-test-data";

const auditEventModel = (): ReturnType<typeof createAuditEventModel> => {
  return createAuditEventModel(mongoose.connection);
};

const getResetRecordCounts = async (): Promise<Record<string, number>> => {
  const [auditEvents, consentForms, consentResponses, featureFlags, projects, todos] =
    await Promise.all([
      auditEventModel().countDocuments(),
      ConsentForm.countDocuments(),
      ConsentResponse.countDocuments(),
      FeatureFlag.countDocuments(),
      Project.countDocuments({deleted: {$ne: true}}),
      Todo.countDocuments({deleted: {$ne: true}}),
    ]);
  return {
    auditEvents,
    consentForms,
    consentResponses,
    featureFlags,
    projects,
    todos,
  };
};

const clearResettableData = async (): Promise<void> => {
  const [projects, todos] = await Promise.all([Project.find({}), Todo.find({})]);
  for (const project of projects) {
    project.deleted = true;
    await project.save();
  }
  for (const todo of todos) {
    todo.deleted = true;
    await todo.save();
  }

  await Promise.all([
    auditEventModel().deleteMany({}),
    ConsentResponse.deleteMany({}),
    FeatureFlag.deleteMany({}),
  ]);
  await ConsentForm.deleteMany({});
};

export const isDatabaseResetAllowed = ({
  isExplicitlyAllowed,
  isProduction,
}: {
  isExplicitlyAllowed: boolean;
  isProduction: boolean;
}): boolean => {
  return !isProduction || isExplicitlyAllowed;
};

export const resetExampleDatabase = async (
  wetRun: boolean,
  ctx?: ScriptContext
): Promise<ScriptResult> => {
  const counts = await getResetRecordCounts();
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const summary = Object.entries(counts).map(([name, count]) => `${name}: ${count}`);

  if (!wetRun) {
    return {
      results: [`Dry run: would reset ${total} record(s)`, ...summary],
      success: true,
    };
  }

  const isAllowed = isDatabaseResetAllowed({
    isExplicitlyAllowed: process.env.ALLOW_ADMIN_DB_RESET === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
  if (!isAllowed) {
    return {
      results: [
        "Live database reset is disabled in production. Set ALLOW_ADMIN_DB_RESET=true to enable it explicitly.",
      ],
      success: false,
    };
  }

  await ctx?.updateProgress(20, "Resetting", "Clearing example application data");
  await clearResettableData();
  await ctx?.checkCancellation();
  await ctx?.updateProgress(60, "Seeding", "Restoring default users and records");
  await seedDefaultData();
  const featureFlagResult = await seedFeatureFlags();
  await ctx?.updateProgress(90, "Verifying", "Checking restored data");

  return {
    results: [
      `Reset ${total} record(s)`,
      ...summary,
      "Preserved users, authentication records, RBAC roles, and script history",
      ...featureFlagResult.results,
    ],
    success: featureFlagResult.success,
  };
};

/**
 * Scripts registered on the admin panel. Exported separately from the server so the
 * same definitions can be exposed both via the admin HTTP routes (AdminApp) and as a
 * project CLI (`bun run script <name>`). Argument handling is identical in both.
 */
export const adminScripts: AdminScriptConfig[] = [
  {
    args: [
      {
        default: "all",
        description: "Which collection to count: todos, users, or all",
        example: "todos",
        name: "model",
        type: "string",
      },
    ],
    description: "Count all todos and users in the database",
    name: "countRecords",
    runner: async (wetRun, ctx) => {
      const model = ctx?.args.getString("model", "all") ?? "all";
      const results: string[] = [];

      if (model === "todos" || model === "all") {
        const todoCount = await Todo.countDocuments();
        results.push(`Found ${todoCount} todos`);
      }
      if (model === "users" || model === "all") {
        const userCount = await User.countDocuments();
        results.push(`Found ${userCount} users`);
      }
      if (results.length === 0) {
        results.push(`Unknown model "${model}". Use one of: todos, users, all`);
        return {results, success: false};
      }

      if (wetRun) {
        results.push("Wet run: no additional changes made by this script");
      } else {
        results.push("Dry run: no changes made");
      }
      return {results, success: true};
    },
  },
  {
    description:
      "Sync consent forms (Terms of Service, Privacy Policy) from code definitions to the database",
    name: "syncConsents",
    runner: async (wetRun) => {
      const result = await syncConsents(consentDefinitions, {
        deactivateRemoved: true,
        dryRun: !wetRun,
      });
      const results: string[] = [];
      if (result.created.length > 0) {
        results.push(`Created: ${result.created.join(", ")}`);
      }
      if (result.updated.length > 0) {
        results.push(`Updated: ${result.updated.join(", ")}`);
      }
      if (result.deactivated.length > 0) {
        results.push(`Deactivated: ${result.deactivated.join(", ")}`);
      }
      if (result.unchanged.length > 0) {
        results.push(`Unchanged: ${result.unchanged.join(", ")}`);
      }
      if (results.length === 0) {
        results.push("Nothing to do");
      }
      return {results, success: true};
    },
  },
  {
    description:
      "Seed example feature flags (boolean and variant). Skips flags that already exist.",
    name: "seedFeatureFlags",
    runner: async (wetRun) => {
      if (!wetRun) {
        return {
          results: [
            "Dry run: would create up to 5 example feature flags",
            "Run as wet run to actually create them",
          ],
          success: true,
        };
      }
      return seedFeatureFlags();
    },
  },
  {
    description:
      "Reset example application data and restore defaults. Preserves users, authentication, RBAC roles, and script history.",
    name: "resetDatabase",
    runner: resetExampleDatabase,
  },
  {
    description:
      "Load the synthetic chat-safety dataset (12 proofread two-person chats), screen prompt v1 and v2, judge prompt, and agreement evaluator. Idempotent. Also loads on boot when SEED_DEFAULTS=true. CLI: bun run script seedChatSafetyDataset --wet",
    name: "seedChatSafetyDataset",
    runner: async (wetRun) => {
      const result = await seedChatSafetyDataset({dryRun: !wetRun});
      return {results: result.results, success: true};
    },
  },
  {
    description:
      "Enqueue the example/dlq-demo job so the admin Jobs screen can demonstrate retry and dead-letter flows.",
    name: "enqueueDlqDemoJob",
    runner: async (wetRun) => {
      if (!wetRun) {
        return {
          results: ["Dry run: would enqueue example/dlq-demo"],
          success: true,
        };
      }
      const job = await getJobsService().enqueue({
        name: "example/dlq-demo",
        payload: {source: "enqueueDlqDemoJob"},
      });
      return {
        results: [`Enqueued example/dlq-demo as job ${String(job._id)}`],
        success: true,
      };
    },
  },
  {
    args: [
      {
        default: 2,
        description: "How many demo approvals to request (1-20)",
        example: "2",
        name: "count",
        type: "number",
      },
      {
        default: "Demo approval",
        description: "Title prefix; each approval is titled '<prefix> <n> of <count>'",
        example: "Demo approval",
        name: "prefix",
        type: "string",
      },
    ],
    description:
      "Start demo.approvalDemo harness tasks; each waits for an admin decision in AI Harness > Approvals.",
    name: "startHarnessApprovalDemo",
    runner: startApprovalDemo,
  },
  {
    args: [
      {
        default: DEFAULT_INTAKE_PATIENT_ID,
        description: "FakePatientChart patientId to summarize (seeded: p-1001, p-1002, p-1003)",
        example: DEFAULT_INTAKE_PATIENT_ID,
        name: "patientId",
        type: "string",
      },
      {
        description: "Idempotency key; defaults to intake-<patientId>. Use a new one to rerun.",
        example: "intake-p-1001-2",
        name: "requestId",
        type: "string",
      },
    ],
    description:
      "Start a clinic.intakeSummary run: fetch the chart, summarize it, wait for clinician sign-off in AI Harness > Approvals, then file the note.",
    name: "startClinicalIntake",
    runner: startClinicalIntake,
  },
];
