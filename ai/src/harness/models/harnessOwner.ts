import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import type {HarnessOwnerDocument, HarnessOwnerModel} from "../../types/harness";

const harnessOwnerSchema = new mongoose.Schema<HarnessOwnerDocument, HarnessOwnerModel>(
  {
    expiresAt: {
      description: "When the owner lease lapses unless the holder renews it",
      required: true,
      type: Date,
    },
    key: {
      description: "Lease name; one row per singleton lease (the in-process runner uses default)",
      required: true,
      type: String,
    },
    owner: {
      description: "Runner instance id that holds the lease",
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

harnessOwnerSchema.plugin(createdUpdatedPlugin);
harnessOwnerSchema.plugin(findOneOrNone);
harnessOwnerSchema.plugin(findExactlyOne);
harnessOwnerSchema.index({key: 1}, {unique: true});

export const registerHarnessOwner = (): HarnessOwnerModel => {
  if (mongoose.models.HarnessOwner) {
    return mongoose.models.HarnessOwner as HarnessOwnerModel;
  }
  return mongoose.model<HarnessOwnerDocument, HarnessOwnerModel>(
    "HarnessOwner",
    harnessOwnerSchema
  );
};
