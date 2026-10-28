import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import mongoose from "mongoose";
import {ObservabilityApp, resetObservabilityApp} from "../observabilityApp";
import {createLocalObservabilityPlugin} from "./localPlugin";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsScore} from "./models/obsScore";
import {registerObsTrace} from "./models/obsTrace";

describe("local observability models", () => {
  afterEach(() => {
    resetObservabilityApp();
  });

  beforeEach(async () => {
    const ObsPrompt = registerObsPrompt();
    const ObsPromptVersion = registerObsPromptVersion();
    const ObsPromptLabel = registerObsPromptLabel();
    const ObsScore = registerObsScore();
    await ObsPrompt.deleteMany({});
    await ObsPromptVersion.deleteMany({});
    await ObsPromptLabel.deleteMany({});
    await ObsScore.deleteMany({});
  });

  it("registers models when the local plugin constructs", () => {
    const plugin = createLocalObservabilityPlugin();
    const app = new ObservabilityApp({plugins: [plugin]});
    expect(app.control.prompts).toBe("local");
    expect(mongoose.models.ObsPrompt).toBeDefined();
    expect(mongoose.models.ObsTrace).toBeDefined();
  });

  it("leaves a prompt version unchanged after a later save attempt", async () => {
    const ObsPrompt = registerObsPrompt();
    const ObsPromptVersion = registerObsPromptVersion();
    const prompt = await ObsPrompt.create({folder: "examples", name: "greeter"});
    const version = await ObsPromptVersion.create({
      promptId: prompt._id,
      system: "You are v1",
      type: "text",
      version: 1,
    });

    version.system = "mutated";
    await expect(version.save()).rejects.toThrow(/immutable/);

    const reloaded = await ObsPromptVersion.findExactlyOne({_id: version._id});
    expect(reloaded.system).toBe("You are v1");
  });

  it("enforces unique (promptId, label)", async () => {
    const ObsPrompt = registerObsPrompt();
    const ObsPromptVersion = registerObsPromptVersion();
    const ObsPromptLabel = registerObsPromptLabel();
    const prompt = await ObsPrompt.create({folder: "examples", name: "unique-label"});
    const version = await ObsPromptVersion.create({
      promptId: prompt._id,
      type: "text",
      version: 1,
    });
    await ObsPromptLabel.syncIndexes();
    await ObsPromptLabel.create({
      label: "production",
      promptId: prompt._id,
      versionId: version._id,
    });

    await expect(
      ObsPromptLabel.create({
        label: "production",
        promptId: prompt._id,
        versionId: version._id,
      })
    ).rejects.toThrow();
  });

  it("loads a version with findExactlyOne and findOneOrNone", async () => {
    const ObsPrompt = registerObsPrompt();
    const ObsPromptVersion = registerObsPromptVersion();
    const prompt = await ObsPrompt.create({folder: "examples", name: "lookup"});
    const created = await ObsPromptVersion.create({
      promptId: prompt._id,
      type: "text",
      version: 1,
    });

    const found = await ObsPromptVersion.findExactlyOne({_id: created._id});
    expect(found.version).toBe(1);
    const missing = await ObsPromptVersion.findOneOrNone({version: 99});
    expect(missing).toBeNull();
  });

  it("does not declare a unique index on scores", () => {
    const ObsScore = registerObsScore();
    const uniqueIndexes = ObsScore.schema
      .indexes()
      .filter((entry) => Boolean((entry[1] as {unique?: boolean} | undefined)?.unique));
    expect(uniqueIndexes.length).toBe(0);
  });

  it("declares ObsTrace compound indexes in IP key order", () => {
    const ObsTrace = registerObsTrace();
    const serialized = ObsTrace.schema.indexes().map(([fields]) => JSON.stringify(fields));
    expect(serialized).toContain('{"created":-1,"userId":1}');
    expect(serialized).toContain('{"sessionId":1,"created":-1}');
    expect(serialized).toContain('{"status":1,"created":-1}');
    expect(serialized).toContain('{"prompts.name":1,"prompts.version":1}');
    expect(serialized).toContain('{"flaggedForDataset":1,"created":-1}');
  });

  it("declares ObsExperiment promptName list index", () => {
    const ObsExperiment = registerObsExperiment();
    const serialized = ObsExperiment.schema.indexes().map(([fields]) => JSON.stringify(fields));
    expect(serialized).toContain('{"promptName":1,"created":-1}');
  });
});
