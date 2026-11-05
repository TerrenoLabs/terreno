import type mongoose from "mongoose";
import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "../plugins";
import type {RequestCredential} from "../requestContext";

/** Outcome of one MCP tool call. */
export type McpRequestLogOutcome = "ok" | "tool_error" | "exception";

/**
 * Metadata for one MCP tool call. Holds no tool arguments, results, or error text, since those
 * can carry personal data.
 */
export interface McpRequestLogDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  created: Date;
  credential?: RequestCredential;
  durationMs: number;
  /** Error class name for an `exception` outcome, such as `ForbiddenError`. Never the message. */
  errorName?: string;
  expiresAt: Date;
  oauthClientId?: string;
  oauthFamilyId?: string;
  outcome: McpRequestLogOutcome;
  serviceTokenId?: mongoose.Types.ObjectId;
  toolName: string;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
}

export type McpRequestLogMethods = Record<string, never>;

export interface McpRequestLogStatics
  extends FindExactlyOnePlugin<McpRequestLogDocument>,
    FindOneOrNonePlugin<McpRequestLogDocument> {}

export type McpRequestLogModel = mongoose.Model<McpRequestLogDocument> & McpRequestLogStatics;

export type McpRequestLogSchema = mongoose.Schema<
  McpRequestLogDocument,
  McpRequestLogModel,
  McpRequestLogMethods
>;

/** Where an MCP tool comes from. */
export type McpToolSource = "model" | "custom";

/** Admin switch and registry entry for one MCP tool. A tool with no row is enabled. */
export interface McpToolSettingDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  created: Date;
  description?: string;
  enabled: boolean;
  /** False when the running server no longer registers this tool. */
  registered: boolean;
  lastRegisteredAt?: Date;
  name: string;
  source: McpToolSource;
  updated: Date;
}

export type McpToolSettingMethods = Record<string, never>;

export interface McpToolSettingStatics
  extends FindExactlyOnePlugin<McpToolSettingDocument>,
    FindOneOrNonePlugin<McpToolSettingDocument> {
  /** Names of tools an admin turned off. */
  disabledNames: (this: McpToolSettingModel) => Promise<Set<string>>;
  /** Upsert one row per registered tool and mark rows for tools that are gone. */
  syncRegistered: (
    this: McpToolSettingModel,
    tools: Array<{description: string; name: string; source: McpToolSource}>
  ) => Promise<void>;
}

export type McpToolSettingModel = mongoose.Model<McpToolSettingDocument> & McpToolSettingStatics;

export type McpToolSettingSchema = mongoose.Schema<
  McpToolSettingDocument,
  McpToolSettingModel,
  McpToolSettingMethods
>;
