import type {AnyTerrenoAccess} from "@terreno/api";
import {logger, TerrenoApp, type TerrenoUserModel} from "@terreno/api";
import type {JobsApp} from "@terreno/jobs";
import mongoose from "mongoose";
import {access} from "../access";
import {Configuration} from "../models/configuration";
import {User} from "../models/user";
import {connectToMongoDB} from "../utils/database";
import {createExampleJobsApp} from "./createExampleJobsApp";
import {registerJobsWorkerShutdown} from "./shutdownJobsWorker";

export interface BootstrapJobsWorkerDeps {
  accessControl: AnyTerrenoAccess;
  connectMongo: () => Promise<void>;
  createJobsApp: (options: {accessControl: AnyTerrenoAccess}) => JobsApp;
  disconnectMongo: () => Promise<void>;
  exitProcess: (code: number) => void;
  registerProcessShutdown: (jobsApp: JobsApp, onShutdown: () => Promise<void>) => void;
  seedRoles: () => Promise<void>;
  shutdownConfiguration: () => Promise<void>;
  userModel: TerrenoUserModel;
}

export interface BootstrapJobsWorkerResult {
  jobsApp: JobsApp;
  terrenoApp: TerrenoApp;
}

const defaultDeps: BootstrapJobsWorkerDeps = {
  accessControl: access,
  connectMongo: connectToMongoDB,
  createJobsApp: createExampleJobsApp,
  disconnectMongo: async () => {
    await mongoose.disconnect();
  },
  exitProcess: (code) => {
    process.exit(code);
  },
  registerProcessShutdown: (jobsApp, onShutdown) => {
    registerJobsWorkerShutdown(jobsApp);
    process.once("SIGTERM", () => {
      void onShutdown();
    });
    process.once("SIGINT", () => {
      void onShutdown();
    });
  },
  seedRoles: () => access.roles.seedDefaults(),
  shutdownConfiguration: () => Configuration.shutdown(),
  userModel: User,
};

export const bootstrapJobsWorker = async (
  deps: Partial<BootstrapJobsWorkerDeps> = {}
): Promise<BootstrapJobsWorkerResult> => {
  const resolved = {...defaultDeps, ...deps};

  await resolved.connectMongo();
  await resolved.seedRoles();

  const jobsApp = resolved.createJobsApp({accessControl: resolved.accessControl});
  const terrenoApp = new TerrenoApp({
    skipListen: true,
    userModel: resolved.userModel,
  });
  terrenoApp.register(jobsApp);
  terrenoApp.build();

  const shutdown = async (): Promise<void> => {
    logger.info("[jobs-worker] Shutting down");
    await jobsApp.stopWorker();
    await resolved.shutdownConfiguration();
    await resolved.disconnectMongo();
    resolved.exitProcess(0);
  };

  resolved.registerProcessShutdown(jobsApp, shutdown);

  await jobsApp.startWorker();
  logger.info("[jobs-worker] Mongo poll loop started (shared example job definitions)");

  return {jobsApp, terrenoApp};
};
