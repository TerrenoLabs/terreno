import {describe, expect, it} from "bun:test";

import {FakeClinicalNote} from "../models/fakeClinicalNote";
import {FakePatientChart} from "../models/fakePatientChart";
import {ehr} from "./fakeEhr";

const NOTE = {risk: "low" as const, sources: ["problems"], summary: "Stable."};

describe("fake EHR", () => {
  it("reads a chart as plain JSON, or undefined when the patient is unknown", async () => {
    await FakePatientChart.create({
      dateOfBirth: "1990-01-01",
      name: "Jordan Placeholder",
      patientId: "p-9",
      problems: ["Allergic rhinitis"],
    });
    expect(await ehr.getChart("p-9")).toEqual({
      allergies: [],
      dateOfBirth: "1990-01-01",
      history: "",
      medications: [],
      name: "Jordan Placeholder",
      patientId: "p-9",
      problems: ["Allergic rhinitis"],
    });
    expect(await ehr.getChart("p-missing")).toBeUndefined();
  });

  it("files one note per idempotency key", async () => {
    await FakeClinicalNote.init();
    const first = await ehr.writeNote("p-9", NOTE, {
      idempotencyKey: "note-1",
      signedOffBy: "user-1",
      taskId: "task-1",
    });
    const again = await ehr.writeNote(
      "p-9",
      {...NOTE, summary: "Different"},
      {
        idempotencyKey: "note-1",
      }
    );
    expect(String(again._id)).toBe(String(first._id));
    expect(again.summary).toBe("Stable.");
    expect(first.signedOffBy).toBe("user-1");

    const raced = await Promise.all([
      ehr.writeNote("p-9", NOTE, {idempotencyKey: "note-2"}),
      ehr.writeNote("p-9", NOTE, {idempotencyKey: "note-2"}),
      ehr.writeNote("p-9", NOTE, {idempotencyKey: "note-2"}),
    ]);
    expect(new Set(raced.map((note) => String(note._id))).size).toBe(1);
    expect(await FakeClinicalNote.countDocuments({})).toBe(2);
  });

  it("rethrows write errors other than a duplicate key", async () => {
    await expect(
      ehr.writeNote("p-9", {...NOTE, risk: "extreme" as "low"}, {idempotencyKey: "note-3"})
    ).rejects.toThrow("risk");
  });
});
