import {FakeClinicalNote} from "../models/fakeClinicalNote";
import {FakePatientChart} from "../models/fakePatientChart";
import type {FakeClinicalNoteDocument, IntakeRiskLevel} from "../types/models/fakeEhrTypes";

/** The chart the intake workflow reads: plain JSON, so it can live in task state. */
export interface ChartView {
  allergies: string[];
  dateOfBirth: string;
  history: string;
  medications: string[];
  name: string;
  patientId: string;
  problems: string[];
}

/** What the clinician signs off and the `write` phase files. */
export interface NoteContent {
  risk: IntakeRiskLevel;
  sources: string[];
  summary: string;
}

interface WriteNoteOptions {
  /** One note per key: a repeated write with the same key returns the first note. */
  idempotencyKey: string;
  signedOffBy?: string;
  taskId?: string;
}

const MONGO_DUPLICATE_KEY = 11000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as {code?: unknown}).code === MONGO_DUPLICATE_KEY;

/**
 * Read a patient's chart from the fake EHR, or `undefined` when no chart has that id. A
 * pure read: safe to repeat, so the `fetch` phase is `replay: "safe"`.
 */
const getChart = async (patientId: string): Promise<ChartView | undefined> => {
  const chart = await FakePatientChart.findOneOrNone({patientId});
  if (!chart) {
    return undefined;
  }
  return {
    allergies: [...chart.allergies],
    dateOfBirth: chart.dateOfBirth,
    history: chart.history,
    medications: [...chart.medications],
    name: chart.name,
    patientId: chart.patientId,
    problems: [...chart.problems],
  };
};

/**
 * File a note into the fake EHR. The unique `idempotencyKey` index makes the write
 * idempotent even under a race: the loser re-reads and returns the winner's note.
 */
const writeNote = async (
  patientId: string,
  content: NoteContent,
  options: WriteNoteOptions
): Promise<FakeClinicalNoteDocument> => {
  const existing = await FakeClinicalNote.findOneOrNone({idempotencyKey: options.idempotencyKey});
  if (existing) {
    return existing;
  }
  try {
    return await FakeClinicalNote.create({
      idempotencyKey: options.idempotencyKey,
      patientId,
      risk: content.risk,
      signedOffBy: options.signedOffBy,
      sources: content.sources,
      summary: content.summary,
      taskId: options.taskId,
    });
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    return FakeClinicalNote.findExactlyOne({idempotencyKey: options.idempotencyKey});
  }
};

/** The example's EHR client. Swap this object for a real EHR integration. */
export const ehr = {getChart, writeNote};
