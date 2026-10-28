import type {SeedContext} from "@terreno/api";

import {FakePatientChart} from "../models/fakePatientChart";

/** Synthetic charts for the clinical tracer. No real patient data. */
export const FAKE_PATIENT_CHARTS = [
  {
    allergies: ["Penicillin (hives)"],
    dateOfBirth: "1958-04-12",
    history:
      "Referred after two weeks of exertional dyspnea and ankle swelling; no chest pain at rest.",
    medications: ["Lisinopril 20 mg daily", "Metformin 1000 mg twice daily"],
    name: "Avery Synthetic",
    patientId: "p-1001",
    problems: ["Type 2 diabetes", "Hypertension", "Suspected heart failure"],
  },
  {
    allergies: [],
    dateOfBirth: "1991-09-30",
    history: "Annual intake; reports seasonal allergies only.",
    medications: ["Cetirizine 10 mg as needed"],
    name: "Jordan Placeholder",
    patientId: "p-1002",
    problems: ["Allergic rhinitis"],
  },
  {
    allergies: ["Sulfa drugs (rash)", "Latex (contact dermatitis)"],
    dateOfBirth: "1946-01-05",
    history: "Fall at home last month; family reports new short-term memory lapses.",
    medications: ["Warfarin 5 mg daily", "Donepezil 5 mg nightly", "Furosemide 40 mg daily"],
    name: "Morgan Testcase",
    patientId: "p-1003",
    problems: ["Atrial fibrillation", "Mild cognitive impairment", "Osteoporosis", "CKD stage 3"],
  },
];

/** Upsert the fake EHR charts by `patientId` (the `fakeEhr` seed step). */
export const seedFakeEhr = async (context: SeedContext): Promise<void> => {
  for (const chart of FAKE_PATIENT_CHARTS) {
    await context.upsert(FakePatientChart, {patientId: chart.patientId}, chart);
  }
};
