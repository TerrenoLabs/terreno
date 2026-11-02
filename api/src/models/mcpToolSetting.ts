import {DateTime} from "luxon";
import mongoose from "mongoose";

import {logger} from "../logger";
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

/** How long one process reuses the disabled-tool set before reading it again. */
const DISABLED_NAMES_TTL_MS = 5000;

// Per-process cache so /mcp does not query Mongo on every request. Writes through this model
// clear it at once; other processes pick up a change within DISABLED_NAMES_TTL_MS.
const disabledNamesCache: {expiresAt: number; names?: Set<string>} = {expiresAt: 0};

const clearDisabledNamesCache = (): void => {
  disabledNamesCache.expiresAt = 0;
  disabledNamesCache.names = undefined;
};

for (const hook of [
  "save",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  mcpToolSettingSchema.post(hook, clearDisabledNamesCache);
}
mcpToolSettingSchema.post("bulkWrite", clearDisabledNamesCache);

mcpToolSettingSchema.plugin(createdUpdatedPlugin);
mcpToolSettingSchema.plugin(findOneOrNone);
mcpToolSettingSchema.plugin(findExactlyOne);

mcpToolSettingSchema.statics = {
  ...mcpToolSettingSchema.statics,
  async disabledNames(this: McpToolSettingModel): Promise<Set<string>> {
    const now = DateTime.now().toMillis();
    if (disabledNamesCache.names && now < disabledNamesCache.expiresAt) {
      return disabledNamesCache.names;
    }
    try {
      const rows = await this.find({enabled: false}).select({name: 1}).lean();
      const names = new Set(rows.map((row) => row.name));
      disabledNamesCache.names = names;
      disabledNamesCache.expiresAt = now + DISABLED_NAMES_TTL_MS;
      return names;
    } catch (error) {
      // Keep enforcing the last known switches rather than re-enabling every tool. With no
      // known state, fail the request (closed) instead of serving tools an admin turned off.
      if (disabledNamesCache.names) {
        logger.warn(`[mcp] Tool settings read failed; using last known: ${String(error)}`);
        return disabledNamesCache.names;
      }
      throw error;
    }
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
