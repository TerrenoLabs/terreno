import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import {
  judgeSchemaMissingDimensions,
  runEvaluator,
  runJsonAssertEvaluator,
  runLlmJudgeEvaluator,
} from "./evaluate";
import {createLocalObservabilityBundle} from "./local/localPlugin";
import {registerObsEvaluator} from "./local/models/obsEvaluator";
import {registerObsPrompt} from "./local/models/obsPrompt";
import {registerObsPromptLabel} from "./local/models/obsPromptLabel";
import {registerObsPromptVersion} from "./local/models/obsPromptVersion";
import {LocalPromptStore} from "./local/promptStore";
import {ObservabilityApp, resetObservabilityApp} from "./observabilityApp";

const clearObsPrompts = async (): Promise<void> => {
  await registerObsPromptLabel().deleteMany({});
  await registerObsPromptVersion().deleteMany({});
  await registerObsPrompt().deleteMany({});
};

describe("evaluate", () => {
  let promptStore: LocalPromptStore;

  beforeEach(async () => {
    createLocalObservabilityBundle();
    promptStore = new LocalPromptStore();
    await registerObsEvaluator().deleteMany({});
    await clearObsPrompts();
    await promptStore.create({
      folder: "eval",
      name: "eval-judge-correctness",
      outputSchema: {
        properties: {
          confidence: {type: "number"},
          correct: {type: "boolean"},
        },
        required: ["correct"],
        type: "object",
      },
      system: "Judge correctness",
      type: "text",
    });
    await promptStore.moveLabel("eval-judge-correctness", {label: "production", version: 1});
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  it("records json-assert schema failures without throwing", () => {
    const result = runJsonAssertEvaluator({
      evaluator: {
        dimensions: [{dataType: "boolean", key: "schema_valid", required: true}],
        name: "schema-assert",
        type: "json-assert",
      },
      input: {text: "hi"},
      output: {wrong: true},
      outputSchema: {
        properties: {answer: {type: "string"}},
        required: ["answer"],
        type: "object",
      },
    });
    assert.equal(result.scores?.schema_valid, false);
    assert.include(result.error ?? "", "/");
  });

  it("evaluates path constraints", () => {
    const result = runJsonAssertEvaluator({
      evaluator: {
        assertion: {constraint: "eq:true", path: "ok"},
        dimensions: [{dataType: "boolean", key: "matches", required: true}],
        name: "path-assert",
        type: "json-assert",
      },
      input: {},
      output: {ok: true},
    });
    assert.equal(result.scores?.matches, true);
  });

  it("writes declared llm-judge keys and confidence", async () => {
    const result = await runLlmJudgeEvaluator(
      {
        evaluator: {
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          judgePromptName: "eval-judge-correctness",
          name: "correctness",
          type: "llm-judge",
        },
        input: {question: "2+2"},
        output: "4",
      },
      {
        generateJsonObject: async () => {
          return {confidence: 0.95, correct: true};
        },
      },
      {
        properties: {
          confidence: {type: "number"},
          correct: {type: "boolean"},
        },
        required: ["correct"],
        type: "object",
      }
    );
    assert.deepEqual(result.scores, {correct: true});
    assert.equal(result.confidence, 0.95);
  });

  it("returns an error outcome when judge generation fails", async () => {
    const result = await runEvaluator(
      {
        evaluator: {
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          judgePromptName: "eval-judge-correctness",
          name: "correctness",
          type: "llm-judge",
        },
        input: {},
        output: "nope",
      },
      {
        ai: {
          generateJsonObject: async () => {
            throw new Error("model blew up");
          },
        },
        judgeOutputSchema: {
          properties: {correct: {type: "boolean"}},
          type: "object",
        },
      }
    );
    assert.equal(result.error, "model blew up");
    assert.isUndefined(result.scores);
  });

  it("names missing judge schema dimensions", () => {
    const missing = judgeSchemaMissingDimensions(
      [{dataType: "boolean", key: "correct", required: true}],
      {properties: {helpfulness: {type: "number"}}, type: "object"}
    );
    assert.deepEqual(missing, ["correct"]);
  });

  it("coerces judge dimensions and reports missing required scores", async () => {
    const base = {
      evaluator: {
        assertion: {constraint: "exists", path: "answer"},
        dimensions: [{dataType: "boolean", key: "matches", required: true}],
        name: "path-assert",
        type: "json-assert" as const,
      },
      input: {},
      output: {answer: "ok"},
    };
    assert.equal(runJsonAssertEvaluator(base).scores?.matches, true);

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "notEmpty", path: "answer"},
        },
        output: {answer: "   "},
      }).scores?.matches,
      false
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "type:array", path: "items"},
        },
        output: {items: [1]},
      }).scores?.matches,
      true
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "gte:3", path: "score"},
        },
        output: {score: 4},
      }).scores?.matches,
      true
    );

    const failed = runJsonAssertEvaluator({
      ...base,
      evaluator: {
        ...base.evaluator,
        assertion: {constraint: 'eq:"nope"', path: "answer"},
      },
      output: {answer: "ok"},
    });
    assert.equal(failed.scores?.matches, false);
    assert.include(failed.error ?? "", "Assertion failed");
  });

  it("returns errors for unsupported evaluator modes and missing dimensions", async () => {
    assert.equal(
      runJsonAssertEvaluator({
        evaluator: {
          dimensions: [],
          name: "empty",
          type: "json-assert",
        },
        input: {},
        output: {},
      }).error,
      "json-assert evaluator requires at least one dimension"
    );

    assert.equal(
      (
        await runEvaluator(
          {
            evaluator: {
              dimensions: [{dataType: "boolean", key: "correct", required: true}],
              name: "human",
              type: "human",
            },
            input: {},
            output: {},
          },
          {}
        )
      ).error,
      "human evaluators are not executed automatically"
    );

    assert.equal(
      (
        await runEvaluator(
          {
            evaluator: {
              dimensions: [{dataType: "boolean", key: "correct", required: true}],
              judgePromptName: "eval-judge-correctness",
              name: "correctness",
              type: "llm-judge",
            },
            input: {},
            output: {},
          },
          {}
        )
      ).error,
      "llm-judge execution requires an AI client and judge output schema"
    );
  });

  it("covers path constraint branches and evaluator routing", async () => {
    const base = {
      evaluator: {
        assertion: {constraint: "exists", path: "answer"},
        dimensions: [{dataType: "boolean" as const, key: "matches", required: true}],
        name: "path-assert",
        type: "json-assert" as const,
      },
      input: {},
      output: {answer: "ok"},
    };

    assert.equal(
      runJsonAssertEvaluator({...base, output: {}}).scores?.matches,
      false,
      "exists rejects missing values"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "notEmpty", path: "answer"},
        },
        output: {answer: null},
      }).scores?.matches,
      false,
      "notEmpty rejects null"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "notEmpty", path: "items"},
        },
        output: {items: []},
      }).scores?.matches,
      false,
      "notEmpty rejects empty arrays"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "notEmpty", path: "count"},
        },
        output: {count: 0},
      }).scores?.matches,
      true,
      "notEmpty accepts non-string scalars"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "type:number", path: "score"},
        },
        output: {score: 3},
      }).scores?.matches,
      true,
      "type:number matches numeric values"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "lte:2", path: "score"},
        },
        output: {score: 1},
      }).scores?.matches,
      true,
      "lte passes when value is within bound"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "unknown", path: "answer"},
        },
      }).scores?.matches,
      false,
      "unknown constraints fail closed"
    );

    assert.equal(
      runJsonAssertEvaluator({
        ...base,
        evaluator: {
          ...base.evaluator,
          assertion: {constraint: "eq:{broken", path: "answer"},
        },
        output: {answer: "{broken"},
      }).scores?.matches,
      true,
      "eq uses raw text when JSON parsing fails"
    );

    const jsonAssertViaRunner = await runEvaluator(
      {
        evaluator: base.evaluator,
        input: base.input,
        output: base.output,
      },
      {}
    );
    assert.equal(jsonAssertViaRunner.scores?.matches, true);

    const missingJudgePrompt = await runLlmJudgeEvaluator(
      {
        evaluator: {
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          name: "correctness",
          type: "llm-judge",
        },
        input: {},
        output: "4",
      },
      {generateJsonObject: async () => ({correct: true})},
      {properties: {correct: {type: "boolean"}}, type: "object"}
    );
    assert.equal(missingJudgePrompt.error, "llm-judge evaluator is missing judgePromptName");

    const judged = await runEvaluator(
      {
        evaluator: {
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          judgePromptName: "eval-judge-correctness",
          name: "correctness",
          type: "llm-judge",
        },
        expectedOutput: {answer: "4"},
        input: {question: "2+2"},
        output: "4",
      },
      {
        ai: {
          generateJsonObject: async () => ({confidence: "not-a-number", correct: 1}),
        },
        judgeOutputSchema: {
          properties: {
            confidence: {type: "number"},
            correct: {type: "boolean"},
          },
          required: ["correct"],
          type: "object",
        },
      }
    );
    assert.deepEqual(judged.scores, {correct: true});
    assert.isUndefined(judged.confidence);

    const nonErrorFailure = await runLlmJudgeEvaluator(
      {
        evaluator: {
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          judgePromptName: "eval-judge-correctness",
          name: "correctness",
          type: "llm-judge",
        },
        input: {},
        output: "nope",
      },
      {
        generateJsonObject: async () => {
          throw "boom";
        },
      },
      {properties: {correct: {type: "boolean"}}, type: "object"}
    );
    assert.equal(nonErrorFailure.error, "llm-judge generation failed");
  });

  it("coerces judge dimensions and reports missing required scores", async () => {
    const result = await runLlmJudgeEvaluator(
      {
        evaluator: {
          dimensions: [
            {dataType: "boolean", key: "correct", required: true},
            {dataType: "numeric", key: "helpfulness", required: true},
            {dataType: "categorical", key: "tone", required: false},
          ],
          judgePromptName: "eval-judge-correctness",
          name: "judge",
          type: "llm-judge",
        },
        input: {q: "2+2"},
        output: "4",
      },
      {
        generateJsonObject: async () => {
          return {confidence: "0.8", correct: "true", helpfulness: "not-a-number", tone: 1};
        },
      },
      {
        properties: {
          confidence: {type: "number"},
          correct: {type: "boolean"},
          helpfulness: {type: "number"},
          tone: {type: "string"},
        },
        required: ["correct", "helpfulness"],
        type: "object",
      }
    );
    assert.deepEqual(result.scores, {correct: true, tone: "1"});
    assert.equal(result.confidence, 0.8);
    assert.include(result.error ?? "", "helpfulness");
  });
});

describe("LocalEvaluatorStore phase 2", () => {
  let promptStore: LocalPromptStore;
  let store: import("./local/evaluatorStore").LocalEvaluatorStore;

  beforeEach(async () => {
    new ObservabilityApp({plugins: [createLocalObservabilityBundle().plugin]});
    promptStore = new LocalPromptStore();
    store = new (await import("./local/evaluatorStore")).LocalEvaluatorStore(promptStore);
    await registerObsEvaluator().deleteMany({});
    await clearObsPrompts();
    await promptStore.create({
      folder: "eval",
      name: "eval-judge-correctness",
      outputSchema: {
        properties: {correct: {type: "boolean"}},
        required: ["correct"],
        type: "object",
      },
      system: "Judge",
      type: "text",
    });
    await promptStore.moveLabel("eval-judge-correctness", {label: "production", version: 1});
  });

  afterEach(() => {
    resetObservabilityApp();
  });

  it("rejects a judge whose schema omits a required dimension", async () => {
    try {
      await store.create({
        dimensions: [
          {dataType: "boolean", key: "correct", required: true},
          {dataType: "boolean", key: "grounded", required: true},
        ],
        judgePromptName: "eval-judge-correctness",
        name: "strict-judge",
        target: "generation span",
        type: "llm-judge",
      });
      assert.fail("expected schema mismatch");
    } catch (error) {
      assert.match(String(error), /grounded/);
    }
  });

  it("defaults confidenceAlertBelow to 0.7", async () => {
    const created = await store.create({
      dimensions: [{dataType: "boolean", key: "schema_valid", required: true}],
      name: "schema-assert",
      target: "generation span",
      type: "json-assert",
    });
    assert.equal(created.confidenceAlertBelow, 0.7);
  });

  it("installs llm-judge and human templates", async () => {
    const judge = await store.installTemplate("correctness");
    assert.equal(judge.type, "llm-judge");
    const human = await store.installTemplate("correctness-human");
    assert.equal(human.type, "human");
    const schemaAssert = await store.installTemplate("schema-assert");
    assert.equal(schemaAssert.type, "json-assert");
  });
});
