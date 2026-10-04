import mongoose from "mongoose";
import type {FakePatientChartDocument, FakePatientChartModel} from "../types/models/fakeEhrTypes";
import {addDefaultPlugins} from "./modelPlugins";

/**
 * A patient chart in the example's fake EHR. Synthetic data only: the clinical tracer
 * (`clinic.intakeSummary`) reads it in its `fetch` phase. Seeded by `bun run seed`.
 */
const fakePatientChartSchema = new mongoose.Schema<FakePatientChartDocument, FakePatientChartModel>(
  {
    allergies: {
      default: [],
      description: "Recorded allergies, one entry per allergen and reaction",
      type: [String],
    },
    dateOfBirth: {
      description: "Date of birth as an ISO date (YYYY-MM-DD)",
      required: true,
      type: String,
    },
    history: {
      default: "",
      description: "Free-text history of present illness from the referral",
      type: String,
    },
    medications: {
      default: [],
      description: "Active medications with dose and frequency",
      type: [String],
    },
    name: {
      description: "Synthetic patient display name",
      required: true,
      trim: true,
      type: String,
    },
    patientId: {
      description: "EHR patient identifier the intake workflow is started with",
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    problems: {
      default: [],
      description: "Active problem list entries",
      type: [String],
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(fakePatientChartSchema);

export const FakePatientChart = mongoose.model<FakePatientChartDocument, FakePatientChartModel>(
  "FakePatientChart",
  fakePatientChartSchema
);
