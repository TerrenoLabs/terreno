import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

describe("@terreno/ai root entry", () => {
  it("does not register the Project model until it is used", async () => {
    const ai = await import("../index");
    expect(mongoose.models.Project).toBeUndefined();

    expect(ai.Project.modelName).toBe("Project");
    expect(mongoose.models.Project).toBe(ai.getProjectModel());
  });

  it("forwards statics, construction and instanceof through the deprecated Project export", async () => {
    const {Project} = await import("../index");
    const userId = new mongoose.Types.ObjectId();

    const project = new Project({name: "Roadmap", userId});
    expect(project instanceof Project).toBe(true);
    await project.save();

    const found = await Project.findById(project._id);
    expect(found?.name).toBe("Roadmap");
    expect(await Project.countDocuments({userId})).toBe(1);
  });
});
