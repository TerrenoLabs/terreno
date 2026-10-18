import {afterAll, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {
  getJobsService,
  Job,
  JobSchedule,
  JobsApp,
  MongoJobRunner,
  tryGetJobsService,
  unregisterJobsService,
} from "../index";

afterAll(() => {
  for (const modelName of ["Job", "JobSchedule"]) {
    if (mongoose.models[modelName]) {
      mongoose.deleteModel(modelName);
    }
  }
});

describe("package public exports", () => {
  it("re-exports JobsApp, models, MongoJobRunner, and getJobsService", (): void => {
    assert.equal(JobsApp.name, "JobsApp");
    assert.equal(MongoJobRunner.name, "MongoJobRunner");
    assert.equal(Job.modelName, "TerrenoJob");
    assert.equal(Job.collection.collectionName, "jobs");
    assert.equal(JobSchedule.modelName, "TerrenoJobSchedule");
    assert.equal(JobSchedule.collection.collectionName, "jobschedules");
    assert.equal(typeof getJobsService, "function");
    assert.equal(typeof tryGetJobsService, "function");
    assert.equal(typeof unregisterJobsService, "function");
  });

  it("allows consumers to register generic job model names", (): void => {
    assert.doesNotThrow(() => mongoose.model("Job", new mongoose.Schema({})));
    assert.doesNotThrow(() => mongoose.model("JobSchedule", new mongoose.Schema({})));
  });
});
