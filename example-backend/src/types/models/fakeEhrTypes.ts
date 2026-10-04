import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
import type mongoose from "mongoose";

// Fake EHR model types: the stand-in electronic health record the clinical tracer
// (`clinic.intakeSummary`) reads charts from and files notes into.

/** Intake risk levels the summarizer may assign. */
export const INTAKE_RISK_LEVELS = ["low", "moderate", "high"] as const;
export type IntakeRiskLevel = (typeof INTAKE_RISK_LEVELS)[number];

// biome-ignore lint/complexity/noBannedTypes: No methods.
type FakePatientChartMethods = {};

interface FakePatientChartStatics
  extends FindExactlyOnePlugin<FakePatientChartDocument>,
    FindOneOrNonePlugin<FakePatientChartDocument> {}

export interface FakePatientChartModel
  extends mongoose.Model<FakePatientChartDocument, object, FakePatientChartMethods>,
    FakePatientChartStatics {}

export interface FakePatientChartDocument extends mongoose.Document, FakePatientChartMethods {
  _id: mongoose.Types.ObjectId;
  patientId: string;
  name: string;
  dateOfBirth: string;
  problems: string[];
  medications: string[];
  allergies: string[];
  history: string;
  created: Date;
  updated: Date;
  deleted: boolean;
}

// biome-ignore lint/complexity/noBannedTypes: No methods.
type FakeClinicalNoteMethods = {};

interface FakeClinicalNoteStatics
  extends FindExactlyOnePlugin<FakeClinicalNoteDocument>,
    FindOneOrNonePlugin<FakeClinicalNoteDocument> {}

export interface FakeClinicalNoteModel
  extends mongoose.Model<FakeClinicalNoteDocument, object, FakeClinicalNoteMethods>,
    FakeClinicalNoteStatics {}

export interface FakeClinicalNoteDocument extends mongoose.Document, FakeClinicalNoteMethods {
  _id: mongoose.Types.ObjectId;
  patientId: string;
  idempotencyKey: string;
  taskId?: string;
  summary: string;
  risk: IntakeRiskLevel;
  sources: string[];
  signedOffBy?: string;
  created: Date;
  updated: Date;
  deleted: boolean;
}
