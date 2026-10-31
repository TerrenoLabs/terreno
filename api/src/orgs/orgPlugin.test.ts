import {beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose, {model, Schema, type UpdateQuery} from "mongoose";

import {orgScopedPlugin} from "./orgPlugin";

interface OrgScopedWidget {
  formerOrganizationId?: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  title: string;
}

const widgetSchema = new Schema<OrgScopedWidget>(
  {
    formerOrganizationId: {
      description: "An unrelated organization reference used to test rename protection",
      type: mongoose.Schema.Types.ObjectId,
    },
    title: {description: "Widget title", type: String},
  },
  {strict: "throw"}
);
widgetSchema.plugin(orgScopedPlugin);

const OrgScopedWidgetModel =
  (mongoose.models.OrgScopedWidget as mongoose.Model<OrgScopedWidget> | undefined) ??
  model<OrgScopedWidget>("OrgScopedWidget", widgetSchema);

describe("orgScopedPlugin", () => {
  beforeEach(async () => {
    await OrgScopedWidgetModel.deleteMany({});
    await OrgScopedWidgetModel.syncIndexes();
  });

  it("rejects a save when organizationId is missing", async () => {
    let error: unknown;
    try {
      await OrgScopedWidgetModel.create({title: "No org"});
    } catch (caughtError) {
      error = caughtError;
    }

    assert.instanceOf(error, Error);
    assert.match((error as Error).message, /organizationId/i);
  });

  it("indexes organizationId on the consumer collection", async () => {
    const indexes = await OrgScopedWidgetModel.collection.indexes();
    const orgIndex = indexes.find((index) => {
      return index.key.organizationId === 1;
    });

    assert.isDefined(orgIndex);

    const saved = await OrgScopedWidgetModel.create({
      organizationId: new mongoose.Types.ObjectId(),
      title: "Scoped",
    });
    assert.isDefined(saved.organizationId);
  });

  it("rejects changing organizationId after creation on save", async () => {
    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const widget = await OrgScopedWidgetModel.create({organizationId: orgA, title: "Pinned"});

    widget.organizationId = orgB;
    let error: unknown;
    try {
      await widget.save();
    } catch (caughtError) {
      error = caughtError;
    }

    assert.isDefined(error);
    assert.equal((error as {status?: number}).status, 400);
    assert.equal((error as {title?: string}).title, "organizationId cannot be changed");
  });

  it("rejects changing organizationId through updateOne", async () => {
    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const widget = await OrgScopedWidgetModel.create({organizationId: orgA, title: "Pinned"});

    let error: unknown;
    try {
      await OrgScopedWidgetModel.updateOne({_id: widget._id}, {$set: {organizationId: orgB}});
    } catch (caughtError) {
      error = caughtError;
    }

    assert.isDefined(error);
    assert.equal((error as {status?: number}).status, 400);
    assert.equal((error as {title?: string}).title, "organizationId cannot be changed");

    const reloaded = await OrgScopedWidgetModel.findById(widget._id);
    assert.equal(String(reloaded?.organizationId), String(orgA));
  });

  it("rejects removing or renaming organizationId through query updates", async () => {
    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const widget = await OrgScopedWidgetModel.create({
      formerOrganizationId: orgB,
      organizationId: orgA,
      title: "Pinned",
    });

    const updates: UpdateQuery<OrgScopedWidget>[] = [
      {$unset: {organizationId: 1}},
      {$rename: {organizationId: "formerOrganizationId"}},
      {$rename: {formerOrganizationId: "organizationId"}},
    ];
    for (const update of updates) {
      let error: unknown;
      try {
        await OrgScopedWidgetModel.updateOne({_id: widget._id}, update);
      } catch (caughtError) {
        error = caughtError;
      }

      if (error) {
        assert.equal((error as {status?: number}).status, 400);
        assert.equal((error as {title?: string}).title, "organizationId cannot be changed");
      }

      const reloaded = await OrgScopedWidgetModel.findById(widget._id);
      assert.equal(String(reloaded?.organizationId), String(orgA));
    }
  });
});
