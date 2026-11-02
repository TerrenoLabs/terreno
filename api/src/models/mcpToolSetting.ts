import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import type {McpToolSettingDocument, McpToolSettingModel, McpToolSource} from "../types/mcpAdmin";

/**
 * Registry of MCP tools with an admin on/off switch. Rows are written when the server mounts
 * with `mcpToolSettings` on. A tool with no row, or with `enabled: true`, is served.
 */
const mcpToolSettingSchema = new mongoose.Schema<McpToolSettingDocument, McpToolSettingModel>(
  {
    description: {
      description: "Tool description as sent to MCP clients",
      type: String,
    },
    enabled: {
      default: true,
      description: "When false, the tool is hidden from tools/list and tools/call rejects it",
      type: Boolean,
    },
    lastRegisteredAt: {
      description: "Last server start that registered this tool",
      type: Date,
    },
    name: {
      description: "MCP tool name",
      required: true,
      type: String,
      unique: true,
    },
    registered: {
      default: true,
      description: "False when the running server no longer registers this tool",
      type: Boolean,
    },
    source: {
      description: "model (generated from a modelRouter) or custom (registerMCPTool)",
      enum: ["model", "custom"],
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

mcpToolSettingSchema.plugin(createdUpdatedPlugin);
mcpToolSettingSchema.plugin(findOneOrNone);
mcpToolSettingSchema.plugin(findExactlyOne);

mcpToolSettingSchema.statics = {
  ...mcpToolSettingSchema.statics,
  async disabledNames(this: McpToolSettingModel): Promise<Set<string>> {
    const rows = await this.find({enabled: false}).select({name: 1}).lean();
    return new Set(rows.map((row) => row.name));
  },
  async syncRegistered(
    this: McpToolSettingModel,
    tools: Array<{description: string; name: string; source: McpToolSource}>
  ): Promise<void> {
    const now = DateTime.now().toJSDate();
    if (tools.length > 0) {
      // `enabled` is only set on insert so a restart never undoes an admin's switch.
      await this.bulkWrite(
        tools.map((tool) => ({
          updateOne: {
            filter: {name: tool.name},
            update: {
              $set: {
                description: tool.description,
                lastRegisteredAt: now,
                registered: true,
                source: tool.source,
              },
              $setOnInsert: {enabled: true},
            },
            upsert: true,
          },
        }))
      );
    }
    await this.updateMany(
      {name: {$nin: tools.map((tool) => tool.name)}, registered: {$ne: false}},
      {$set: {registered: false}}
    );
  },
};

export const McpToolSetting =
  (mongoose.models.TerrenoMcpToolSetting as McpToolSettingModel | undefined) ??
  mongoose.model<McpToolSettingDocument, McpToolSettingModel>(
    "TerrenoMcpToolSetting",
    mcpToolSettingSchema,
    "mcptoolsettings"
  );
