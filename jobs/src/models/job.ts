import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import type {JobDocument, JobModel, JobSchema} from "../modelTypes";

const jobSchema: JobSchema = new mongoose.Schema<JobDocument, JobModel>(
  {
    attemptCount: {
      default: 0,
      description: "Number of execution attempts recorded for this job",
      type: Number,
    },
    attempts: {
      default: [],
      description: "History of execution attempts including errors",
      type: [
        {
          _id: false,
          at: {
            description: "When this execution attempt ran",
            required: true,
            type: Date,
          },
          error: {
            description: "Error message captured for this attempt",
            type: String,
          },
          errorClass: {
            description: "Classified error category for this attempt",
            type: String,
          },
        },
      ],
    },
    backoffMs: {
      default: 1_000,
      description: "Base delay in milliseconds for exponential retry backoff",
      type: Number,
    },
    idempotencyKey: {
      description: "Optional deduplication key scoped to the job name",
      type: String,
    },
    lastError: {
      description: "Most recent error message from a failed attempt",
      type: String,
    },
    lockedAt: {
      description: "When this job row was claimed by a worker",
      type: Date,
    },
    lockedBy: {
      description: "Worker identity that claimed this job row",
      type: String,
    },
    maxAttempts: {
      default: 5,
      description: "Maximum execution attempts before the job is dead-lettered",
      type: Number,
    },
    maxBackoffMs: {
      default: 15 * 60 * 1_000,
      description: "Maximum retry delay in milliseconds before backoff is capped",
      type: Number,
    },
    name: {
      description: "Registered handler name for this job",
      index: true,
      required: true,
      type: String,
    },
    payload: {
      description: "JSON-serializable input passed to the handler",
      type: mongoose.Schema.Types.Mixed,
    },
    payloadRedacted: {
      default: false,
      description: "Whether the stored payload has been redacted for admin display",
      type: Boolean,
    },
    retriedById: {
      description: "Follow-up job created by an admin retry action",
      ref: "TerrenoJob",
      type: mongoose.Schema.Types.ObjectId,
    },
    retriedFromId: {
      description: "Original job row that this retry was created from",
      ref: "TerrenoJob",
      type: mongoose.Schema.Types.ObjectId,
    },
    runAt: {
      description: "Earliest time a worker may claim this job",
      index: true,
      required: true,
      type: Date,
    },
    scheduleId: {
      description: "Recurring schedule that enqueued this job, when applicable",
      ref: "TerrenoJobSchedule",
      type: mongoose.Schema.Types.ObjectId,
    },
    status: {
      description: "Current lifecycle status of the job row",
      enum: ["cancelled", "completed", "dead", "failed", "pending", "running", "scheduled"],
      index: true,
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

jobSchema.plugin(createdUpdatedPlugin);
jobSchema.plugin(findOneOrNone);
jobSchema.plugin(findExactlyOne);

jobSchema.index(
  // biome-ignore assist/source/useSortedKeys: IP specifies (name, idempotencyKey) index field order
  {name: 1, idempotencyKey: 1},
  {
    partialFilterExpression: {idempotencyKey: {$exists: true, $type: "string"}},
    unique: true,
  }
);
// biome-ignore assist/source/useSortedKeys: IP specifies (status, runAt) claim index field order
jobSchema.index({status: 1, runAt: 1});
jobSchema.index({scheduleId: 1, status: 1});

export const Job = mongoose.model<JobDocument, JobModel>("TerrenoJob", jobSchema, "jobs");
