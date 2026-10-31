import type mongoose from "mongoose";

export type GptSkillScope = "user" | "global";

/** A reference file stored with a skill; `gcsKey` never leaves the server. */
export interface GptSkillFile {
  filename: string;
  gcsKey: string;
  mimeType: string;
  size: number;
}

export interface GptSkillDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  description: string;
  enabled: boolean;
  files: GptSkillFile[];
  instructions: string;
  name: string;
  ownerId?: mongoose.Types.ObjectId;
  scope: GptSkillScope;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
}

export type GptSkillModel = mongoose.Model<GptSkillDocument>;
