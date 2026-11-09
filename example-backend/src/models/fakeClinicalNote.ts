import mongoose from "mongoose";
import {
  type FakeClinicalNoteDocument,
  type FakeClinicalNoteModel,
  INTAKE_RISK_LEVELS,
} from "../types/models/fakeEhrTypes";
import {addDefaultPlugins} from "./modelPlugins";

/**
 * A note filed into the example's fake EHR by the clinical tracer's `write` phase. The
 * unique `idempotencyKey` (`note-<taskId>`) makes a repeated write return the first note.
 */
const fakeClinicalNoteSchema = new mongoose.Schema<FakeClinicalNoteDocument, FakeClinicalNoteModel>(
  {
    idempotencyKey: {
      description: "Caller-chosen key; one note per key (the intake task uses note-<taskId>)",
      required: true,
      type: String,
      unique: true,
    },
    patientId: {
      description: "EHR patient identifier the note belongs to",
      index: true,
      required: true,
      type: String,
    },
    risk: {
      description: "Intake risk level from the signed-off summary",
      enum: INTAKE_RISK_LEVELS,
      required: true,
      type: String,
    },
    signedOffBy: {
      description: "Id of the user who approved the summary before it was filed",
      type: String,
    },
    sources: {
      default: [],
      description: "Chart sections the summary cites",
      type: [String],
    },
    summary: {
      description: "Signed-off intake summary text",
      required: true,
      type: String,
    },
    taskId: {
      description: "Id of the harness task that filed the note",
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(fakeClinicalNoteSchema);

export const FakeClinicalNote = mongoose.model<FakeClinicalNoteDocument, FakeClinicalNoteModel>(
  "FakeClinicalNote",
  fakeClinicalNoteSchema
);
