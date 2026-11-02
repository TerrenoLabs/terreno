import {DateTime} from "luxon";
import mongoose from "mongoose";

import {logger} from "../logger";
import {McpRequestLog} from "../models/mcpRequestLog";
import {McpToolSetting} from "../models/mcpToolSetting";
import type {McpRequestLogOutcome, McpToolSource} from "../types/mcpAdmin";
import type {MCPAuthResult} from "./auth";
import {getMCPCustomTools} from "./registry";
import type {MCPToolDefinition} from "./toolGenerator";

const DEFAULT_REQUEST_LOG_RETENTION_DAYS = 30;

/** `true` is `{enabled: true}`. Rows keep metadata only and expire after `retentionDays`. */
export type McpRequestLogAppOption = boolean | {enabled: boolean; retentionDays?: number};

export interface ResolvedMcpRequestLogOptions {
  retentionDays: number;
}

export const resolveMcpRequestLogOption = (
  option: McpRequestLogAppOption | undefined
): ResolvedMcpRequestLogOptions | undefined => {
  if (option === true) {
    return {retentionDays: DEFAULT_REQUEST_LOG_RETENTION_DAYS};
  }
  if (!option || typeof option !== "object" || option.enabled !== true) {
    return undefined;
  }
  const retentionDays = option.retentionDays ?? DEFAULT_REQUEST_LOG_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error("mcpRequestLog.retentionDays must be a positive number");
  }
  return {retentionDays};
};

export interface McpToolCallRecord {
  auth?: MCPAuthResult;
  durationMs: number;
  errorName?: string;
  outcome: McpRequestLogOutcome;
  toolName: string;
}

const toObjectId = (value: string | undefined): mongoose.Types.ObjectId | undefined => {
  if (!value || !mongoose.isValidObjectId(value)) {
    return undefined;
  }
  return new mongoose.Types.ObjectId(value);
};

/**
 * Write one request-log row without blocking or failing the tool call. A failed write is
 * logged at debug level and dropped.
 */
export const recordMcpToolCall = (
  record: McpToolCallRecord,
  options: ResolvedMcpRequestLogOptions
): void => {
  const {auth} = record;
  void McpRequestLog.create({
    credential: auth?.credential,
    durationMs: Math.round(record.durationMs),
    errorName: record.errorName,
    expiresAt: DateTime.now().plus({days: options.retentionDays}).toJSDate(),
    oauthClientId: auth?.oauthClientId,
    oauthFamilyId: auth?.oauthFamilyId,
    outcome: record.outcome,
    serviceTokenId: toObjectId(auth?.serviceTokenId),
    toolName: record.toolName,
    userId: toObjectId(auth?.user?.id ? String(auth.user.id) : undefined),
  }).catch((error: unknown) => {
    logger.debug(`[mcp] Request log write failed: ${String(error)}`);
  });
};

/** Register every tool in `McpToolSetting` so admins can see and switch them. */
export const syncMcpToolSettings = async (tools: MCPToolDefinition[]): Promise<void> => {
  const customNames = new Set(getMCPCustomTools().map((tool) => tool.name));
  await McpToolSetting.syncRegistered(
    tools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      source: (customNames.has(tool.name) ? "custom" : "model") as McpToolSource,
    }))
  );
};

/** Tools an admin left on. A tool without a settings row counts as on. */
export const filterEnabledMcpTools = async (
  tools: MCPToolDefinition[]
): Promise<MCPToolDefinition[]> => {
  const disabled = await McpToolSetting.disabledNames();
  if (disabled.size === 0) {
    return tools;
  }
  return tools.filter((tool) => !disabled.has(tool.name));
};
