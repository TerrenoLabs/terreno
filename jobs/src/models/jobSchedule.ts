import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import type {JobScheduleDocument, JobScheduleModel, JobScheduleSchema} from "../modelTypes";

const jobScheduleSchema: JobScheduleSchema = new mongoose.Schema<
  JobScheduleDocument,
  JobScheduleModel
>(
  {
    cron: {
      description: "Cron expression that controls when this schedule fires",
      required: true,
      type: String,
    },
    enabled: {
      default: true,
      description: "Whether the worker should enqueue jobs for this schedule",
      type: Boolean,
    },
    handlerName: {
      description: "Registered job handler name invoked for each schedule tick",
      required: true,
      type: String,
    },
    name: {
      description: "Unique schedule name matching the registered job definition",
      required: true,
      type: String,
      unique: true,
    },
    nextRunAt: {
      description: "Next UTC instant when the scheduler should evaluate this schedule",
      index: true,
      required: true,
      type: Date,
    },
    timezone: {
      default: "UTC",
      description: "IANA timezone used to interpret the cron expression",
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

jobScheduleSchema.plugin(createdUpdatedPlugin);
jobScheduleSchema.plugin(findOneOrNone);
jobScheduleSchema.plugin(findExactlyOne);

jobScheduleSchema.index({enabled: 1, nextRunAt: 1});

export const JobSchedule = mongoose.model<JobScheduleDocument, JobScheduleModel>(
  "TerrenoJobSchedule",
  jobScheduleSchema,
  "jobschedules"
);
