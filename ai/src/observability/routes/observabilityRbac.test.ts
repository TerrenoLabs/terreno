import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  createAccess,
  setupAuth,
  TerrenoApp,
  terrenoStatements,
  type UserModel as UserModelType,
} from "@terreno/api";
import {getBaseServer} from "@terreno/api/testing";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import type TestAgent from "supertest/lib/agent";

import {
  authAsUser,
  authAsUserWithCredentials,
  ensureTestUsers,
  UserModel,
} from "../../tests/helpers";
import {LocalDatasetStore} from "../local/datasetStore";
import {LocalEvaluatorStore} from "../local/evaluatorStore";
import {createLocalObservabilityPlugin} from "../local/localPlugin";
import {registerObsDataset} from "../local/models/obsDataset";
import {registerObsDatasetItem} from "../local/models/obsDatasetItem";
import {registerObsEvaluator} from "../local/models/obsEvaluator";
import {registerObsPrompt} from "../local/models/obsPrompt";
import {registerObsPromptLabel} from "../local/models/obsPromptLabel";
import {registerObsPromptVersion} from "../local/models/obsPromptVersion";
import {registerObsReviewItem} from "../local/models/obsReviewItem";
import {registerObsTrace} from "../local/models/obsTrace";
import {LocalPromptStore} from "../local/promptStore";
import {LocalTraceStore} from "../local/traceStore";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";

const typedUserModel = UserModel as unknown as UserModelType;
const ADMIN_EMAIL = "admin@example.com";
const RBAC_OPERATOR_EMAIL = "obs-rbac-operator@example.com";
const RBAC_OPERATOR_PASSWORD = "obs-rbac-password";
const FIXTURE_PROMPT = "rbac-fixture";
const ADMIN_SHELL: Record<string, string[]> = {admin: ["access"]};

type PasswordedUser = {setPassword: (password: string) => Promise<void>};

interface RouteMappingCase {
  allowAction: string;
  body?: Record<string, unknown>;
  denyAction: string;
  label: string;
  method: "delete" | "get" | "patch" | "post";
  path: string;
  resource: string;
}

interface FixtureIds {
  datasetId: string;
  datasetItemId: string;
  evaluatorId: string;
  reviewItemId: string;
  traceId: string;
}

const ensureRbacOperatorUser = async (): Promise<void> => {
  await UserModel.deleteMany({email: RBAC_OPERATOR_EMAIL});
  const doc = await UserModel.create({
    admin: false,
    email: RBAC_OPERATOR_EMAIL,
    name: "Obs RBAC Operator",
  });
  await (doc as unknown as PasswordedUser).setPassword(RBAC_OPERATOR_PASSWORD);
  await doc.save();
};

const authAsRbacOperator = async (app: express.Application): Promise<TestAgent> => {
  return authAsUserWithCredentials(app, {
    email: RBAC_OPERATOR_EMAIL,
    password: RBAC_OPERATOR_PASSWORD,
  });
};

const buildObservabilityApp = (
  accessControl?: ReturnType<typeof createAccess>
): express.Application => {
  const obsApp = new ObservabilityApp({
    accessControl,
    plugins: [createLocalObservabilityPlugin()],
  });

  if (accessControl) {
    const app = getBaseServer();
    setupAuth(app, typedUserModel);
    addAuthRoutes(app, typedUserModel);
    obsApp.register(app);
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    return app;
  }

  return new TerrenoApp({logRequests: false, skipListen: true, userModel: typedUserModel})
    .register(obsApp)
    .build();
};

const buildRbacObservabilityApp = (
  grantsByEmail: Record<string, Record<string, string[]>>
): express.Application => {
  const accessControl = createAccess({
    connection: mongoose.connection,
    resolvePermissions: async ({user}) => {
      const email = "email" in user && typeof user.email === "string" ? user.email : "";
      return grantsByEmail[email] ?? {};
    },
    statements: terrenoStatements,
  });
  return buildObservabilityApp(accessControl);
};

const grantsFor = (resource: string, actions: string[]): Record<string, string[]> => ({
  ...ADMIN_SHELL,
  [resource]: actions,
});

const sendRequest = async (
  agent: TestAgent,
  case_: RouteMappingCase
): Promise<{status: number}> => {
  const path = case_.path;
  if (case_.method === "get") {
    return agent.get(path);
  }
  if (case_.method === "delete") {
    return agent.delete(path);
  }
  if (case_.method === "patch") {
    return agent.patch(path).send(case_.body ?? {});
  }
  return agent.post(path).send(case_.body ?? {});
};

const clearObservabilityFixtures = async (): Promise<void> => {
  await registerObsPrompt().deleteMany({});
  await registerObsPromptVersion().deleteMany({});
  await registerObsPromptLabel().deleteMany({});
  await registerObsDataset().deleteMany({});
  await registerObsDatasetItem().deleteMany({});
  await registerObsEvaluator().deleteMany({});
  await registerObsTrace().deleteMany({});
  await registerObsReviewItem().deleteMany({});
};

const seedFixtures = async (): Promise<FixtureIds> => {
  await clearObservabilityFixtures();
  const promptStore = new LocalPromptStore();
  await promptStore.create({
    folder: "rbac",
    name: FIXTURE_PROMPT,
    system: "system",
    template: "hello",
    type: "text",
  });

  const datasetStore = new LocalDatasetStore();
  const dataset = await datasetStore.create({name: "rbac-dataset"});
  const datasetItem = await datasetStore.createItem(dataset.id, {input: {text: "fixture"}});
  const evaluator = await new LocalEvaluatorStore().create({
    dimensions: [{dataType: "boolean", key: "ok", required: true}],
    name: "rbac-human",
    target: "full trace",
    type: "human",
  });
  const trace = await new LocalTraceStore().exportTrace({
    id: "rbac-trace",
    name: "rbac",
    prompts: [],
    sensitive: false,
    spans: [
      {
        id: "span",
        kind: "LLM",
        name: "llm",
        startedAt: DateTime.utc().toISO() ?? "",
        status: "ok",
      },
    ],
    startedAt: DateTime.utc().toISO() ?? "",
    status: "ok",
  });
  const agentApp = buildObservabilityApp();
  const adminAgent = await authAsUser(agentApp, "admin");
  const enqueued = await adminAgent.post("/ai/observability/traces/review").send({
    evaluatorId: evaluator.id,
    reason: "manual",
    traceIds: [trace.id],
  });
  const reviewItemId = enqueued.body.data[0].id as string;

  return {
    datasetId: dataset.id,
    datasetItemId: datasetItem.id,
    evaluatorId: evaluator.id,
    reviewItemId,
    traceId: trace.id,
  };
};

describe("observability route RBAC", () => {
  beforeAll(async () => {
    await ensureTestUsers();
    await ensureRbacOperatorUser();
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    await clearObservabilityFixtures();
  });

  it("allows legacy admin callers when accessControl is omitted", async () => {
    const app = buildObservabilityApp();
    const agent = await authAsUser(app, "admin");
    const response = await agent.post("/ai/observability/prompts").send({
      folder: "examples",
      name: "legacy-admin",
      system: "Hi",
      template: "Hello",
      type: "text",
    });
    expect(response.status).toBe(201);
  });

  it("denies observability routes when RBAC grants omit admin:access", async () => {
    const app = buildRbacObservabilityApp({
      [RBAC_OPERATOR_EMAIL]: {
        aiPrompt: ["list", "read"],
      },
    });
    const agent = await authAsRbacOperator(app);
    await agent.get("/ai/observability/prompts").expect(403);
  });

  it("allows composed read-only shell with admin:access and aiPrompt list/read only", async () => {
    await seedFixtures();
    const app = buildRbacObservabilityApp({
      [RBAC_OPERATOR_EMAIL]: {
        admin: ["access"],
        aiPrompt: ["list", "read"],
      },
    });
    const agent = await authAsRbacOperator(app);
    await agent.get("/ai/observability/prompts").expect(200);
    const createResponse = await agent.post("/ai/observability/prompts").send({
      folder: "rbac",
      name: "read-only-shell-deny",
      system: "s",
      template: "t",
      type: "text",
    });
    expect(createResponse.status).toBe(403);
  });

  it("keeps legacy user.admin as full access when accessControl is configured", async () => {
    const app = buildRbacObservabilityApp({
      [ADMIN_EMAIL]: {
        admin: ["access"],
      },
    });
    const agent = await authAsUser(app, "admin");
    await agent
      .post("/ai/observability/prompts")
      .send({
        folder: "examples",
        name: "legacy-bypass",
        system: "Hi",
        template: "Hello",
        type: "text",
      })
      .expect(201);
  });

  const buildMappingCases = (fixtures: FixtureIds): RouteMappingCase[] => {
    const missingId = new mongoose.Types.ObjectId().toString();
    return [
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiPrompt:list",
        method: "get",
        path: "/ai/observability/prompts",
        resource: "aiPrompt",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiPrompt:read",
        method: "get",
        path: `/ai/observability/prompts/${FIXTURE_PROMPT}`,
        resource: "aiPrompt",
      },
      {
        allowAction: "create",
        body: {folder: "rbac", name: "rbac-new", system: "s", template: "t", type: "text"},
        denyAction: "list",
        label: "aiPrompt:create",
        method: "post",
        path: "/ai/observability/prompts",
        resource: "aiPrompt",
      },
      {
        allowAction: "update",
        body: {system: "v2", template: "v2", type: "text"},
        denyAction: "create",
        label: "aiPrompt:update",
        method: "post",
        path: `/ai/observability/prompts/${FIXTURE_PROMPT}/versions`,
        resource: "aiPrompt",
      },
      {
        allowAction: "promote",
        body: {label: "production", version: 1},
        denyAction: "update",
        label: "aiPrompt:promote",
        method: "post",
        path: `/ai/observability/prompts/${FIXTURE_PROMPT}/labels`,
        resource: "aiPrompt",
      },
      {
        allowAction: "playground",
        body: {variables: {}, version: 1},
        denyAction: "promote",
        label: "aiPrompt:playground",
        method: "post",
        path: `/ai/observability/prompts/${FIXTURE_PROMPT}/playground`,
        resource: "aiPrompt",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiTrace:list (traces)",
        method: "get",
        path: "/ai/observability/traces",
        resource: "aiTrace",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiTrace:list (status)",
        method: "get",
        path: "/ai/observability/status",
        resource: "aiTrace",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiTrace:read (detail)",
        method: "get",
        path: `/ai/observability/traces/${fixtures.traceId}`,
        resource: "aiTrace",
      },
      {
        allowAction: "read",
        body: {},
        denyAction: "list",
        label: "aiTrace:read (test-multi-stage)",
        method: "post",
        path: "/ai/observability/traces/test-multi-stage",
        resource: "aiTrace",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiReview:list",
        method: "get",
        path: "/ai/observability/review",
        resource: "aiReview",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiReview:read",
        method: "get",
        path: `/ai/observability/review/${fixtures.reviewItemId}`,
        resource: "aiReview",
      },
      {
        allowAction: "score",
        body: {name: "manual", value: 1},
        denyAction: "assign",
        label: "aiReview:score (trace scores)",
        method: "post",
        path: `/ai/observability/traces/${fixtures.traceId}/scores`,
        resource: "aiReview",
      },
      {
        allowAction: "score",
        body: {action: "submit", scores: {ok: true}},
        denyAction: "assign",
        label: "aiReview:score (review submit)",
        method: "post",
        path: `/ai/observability/review/${fixtures.reviewItemId}`,
        resource: "aiReview",
      },
      {
        allowAction: "assign",
        body: {
          evaluatorId: fixtures.evaluatorId,
          reason: "manual",
          traceIds: [fixtures.traceId],
        },
        denyAction: "score",
        label: "aiReview:assign (enqueue)",
        method: "post",
        path: "/ai/observability/traces/review",
        resource: "aiReview",
      },
      {
        allowAction: "assign",
        body: {action: "assign", assigneeId: new mongoose.Types.ObjectId().toString()},
        denyAction: "score",
        label: "aiReview:assign (review item)",
        method: "post",
        path: `/ai/observability/review/${fixtures.reviewItemId}`,
        resource: "aiReview",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiDataset:list",
        method: "get",
        path: "/ai/observability/datasets",
        resource: "aiDataset",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiDataset:read",
        method: "get",
        path: `/ai/observability/datasets/${fixtures.datasetId}`,
        resource: "aiDataset",
      },
      {
        allowAction: "create",
        body: {name: "rbac-dataset-2"},
        denyAction: "list",
        label: "aiDataset:create",
        method: "post",
        path: "/ai/observability/datasets",
        resource: "aiDataset",
      },
      {
        allowAction: "update",
        body: {name: "rbac-dataset-renamed"},
        denyAction: "create",
        label: "aiDataset:update (patch)",
        method: "patch",
        path: `/ai/observability/datasets/${fixtures.datasetId}`,
        resource: "aiDataset",
      },
      {
        allowAction: "update",
        body: {rows: [{input: {text: "x"}}]},
        denyAction: "read",
        label: "aiDataset:update (import)",
        method: "post",
        path: `/ai/observability/datasets/${fixtures.datasetId}/import`,
        resource: "aiDataset",
      },
      {
        allowAction: "update",
        body: {datasetId: fixtures.datasetId, traceId: fixtures.traceId},
        denyAction: "read",
        label: "aiDataset:update (add-to-dataset)",
        method: "post",
        path: "/ai/observability/traces/add-to-dataset",
        resource: "aiDataset",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiDataset:read (items list)",
        method: "get",
        path: `/ai/observability/datasets/${fixtures.datasetId}/items`,
        resource: "aiDataset",
      },
      {
        allowAction: "update",
        body: {input: {text: "rbac-new-item"}},
        denyAction: "read",
        label: "aiDataset:update (create item)",
        method: "post",
        path: `/ai/observability/datasets/${fixtures.datasetId}/items`,
        resource: "aiDataset",
      },
      {
        allowAction: "update",
        body: {input: {text: "rbac-patched-item"}},
        denyAction: "create",
        label: "aiDataset:update (patch item)",
        method: "patch",
        path: `/ai/observability/datasets/${fixtures.datasetId}/items/${fixtures.datasetItemId}`,
        resource: "aiDataset",
      },
      {
        allowAction: "delete",
        denyAction: "update",
        label: "aiDataset:delete (item)",
        method: "delete",
        path: `/ai/observability/datasets/${fixtures.datasetId}/items/${fixtures.datasetItemId}`,
        resource: "aiDataset",
      },
      {
        allowAction: "delete",
        denyAction: "update",
        label: "aiDataset:delete",
        method: "delete",
        path: `/ai/observability/datasets/${missingId}`,
        resource: "aiDataset",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiExperiment:list",
        method: "get",
        path: "/ai/observability/experiments",
        resource: "aiExperiment",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiExperiment:read",
        method: "get",
        path: `/ai/observability/experiments/${missingId}`,
        resource: "aiExperiment",
      },
      {
        allowAction: "create",
        body: {
          datasetId: fixtures.datasetId,
          evaluatorIds: [],
          promptName: FIXTURE_PROMPT,
          versions: [1, 2],
        },
        denyAction: "list",
        label: "aiExperiment:create (estimate)",
        method: "post",
        path: "/ai/observability/experiments/estimate",
        resource: "aiExperiment",
      },
      {
        allowAction: "create",
        body: {
          datasetId: fixtures.datasetId,
          evaluatorIds: [],
          promptName: FIXTURE_PROMPT,
          versions: [1, 2],
        },
        denyAction: "list",
        label: "aiExperiment:create",
        method: "post",
        path: "/ai/observability/experiments",
        resource: "aiExperiment",
      },
      {
        allowAction: "promote",
        body: {version: 1},
        denyAction: "read",
        label: "aiExperiment:promote",
        method: "post",
        path: `/ai/observability/experiments/${missingId}/promote`,
        resource: "aiExperiment",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiEvaluator:list (templates)",
        method: "get",
        path: "/ai/observability/evaluators/templates",
        resource: "aiEvaluator",
      },
      {
        allowAction: "list",
        denyAction: "read",
        label: "aiEvaluator:list",
        method: "get",
        path: "/ai/observability/evaluators",
        resource: "aiEvaluator",
      },
      {
        allowAction: "create",
        denyAction: "list",
        label: "aiEvaluator:create (template)",
        method: "post",
        path: "/ai/observability/evaluators/templates/correctness-human",
        resource: "aiEvaluator",
      },
      {
        allowAction: "create",
        body: {
          dimensions: [{dataType: "boolean", key: "pass", required: true}],
          name: "rbac-eval",
          target: "full trace",
          type: "human",
        },
        denyAction: "list",
        label: "aiEvaluator:create",
        method: "post",
        path: "/ai/observability/evaluators",
        resource: "aiEvaluator",
      },
      {
        allowAction: "read",
        denyAction: "list",
        label: "aiEvaluator:read",
        method: "get",
        path: `/ai/observability/evaluators/${fixtures.evaluatorId}`,
        resource: "aiEvaluator",
      },
      {
        allowAction: "update",
        body: {description: "updated"},
        denyAction: "read",
        label: "aiEvaluator:update",
        method: "patch",
        path: `/ai/observability/evaluators/${fixtures.evaluatorId}`,
        resource: "aiEvaluator",
      },
      {
        allowAction: "delete",
        denyAction: "update",
        label: "aiEvaluator:delete",
        method: "delete",
        path: `/ai/observability/evaluators/${fixtures.evaluatorId}`,
        resource: "aiEvaluator",
      },
    ];
  };

  describe("route action mapping", () => {
    it("returns 403 when only the neighboring action is granted", async () => {
      const fixtures = await seedFixtures();
      for (const case_ of buildMappingCases(fixtures)) {
        const app = buildRbacObservabilityApp({
          [RBAC_OPERATOR_EMAIL]: grantsFor(case_.resource, [case_.denyAction]),
        });
        const agent = await authAsRbacOperator(app);
        const response = await sendRequest(agent, case_);
        expect(response.status).toBe(403);
      }
    });

    it("passes middleware when the mapped action is granted", async () => {
      const fixtures = await seedFixtures();
      const cases = buildMappingCases(fixtures);
      for (let index = 0; index < cases.length; index += 1) {
        const freshFixtures = await seedFixtures();
        const case_ = buildMappingCases(freshFixtures)[index];
        const app = buildRbacObservabilityApp({
          [RBAC_OPERATOR_EMAIL]: grantsFor(case_.resource, [case_.allowAction]),
        });
        const agent = await authAsRbacOperator(app);
        const response = await sendRequest(agent, case_);
        expect(response.status).not.toBe(403);
      }
    });
  });
});
