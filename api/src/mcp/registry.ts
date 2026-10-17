import type {Model} from "mongoose";
import type {ZodType} from "zod";

import type {ModelRouterOptions} from "../api";
import type {User} from "../auth";
import {
  clearCollectionRegistry,
  listCollections,
  registerCollection,
  replaceCollectionOptions,
} from "../collectionRegistry";
import type {MCPConfig, MCPRegistryEntry, MCPToolArgs, MCPToolResult} from "./types";

export interface MCPCustomTool {
  description: string;
  handler: (args: MCPToolArgs, user?: User) => Promise<MCPToolResult>;
  name: string;
  zodSchema: ZodType;
}

const mcpCustomTools: MCPCustomTool[] = [];

const findCollectionByModelName = (modelName: string) =>
  listCollections().find((record) => record.model.modelName === modelName);

const mcpRoutePathForModel = <T>(model: Model<T>): string =>
  findCollectionByModelName(model.modelName)?.routePath ?? `/_mcp/${model.modelName}`;

export const registerMCPModel = <T>(
  model: Model<T>,
  config: MCPConfig,
  options: ModelRouterOptions<T>
): void => {
  registerCollection({
    model,
    options: {...options, mcp: config},
    routePath: mcpRoutePathForModel(model),
  });
};

/**
 * Catalog a pathless modelRouter whose actions opt into MCP but whose CRUD does not, so the
 * action tools can find its model and options. Routers with a path are cataloged already.
 */
export const registerMCPActionModel = <T>(
  model: Model<T>,
  options: ModelRouterOptions<T>
): void => {
  registerCollection({model, options, routePath: mcpRoutePathForModel(model)});
};

export const updateMCPRegistryOptions = (
  modelName: string,
  options: ModelRouterOptions<unknown>
): void => {
  const existing = findCollectionByModelName(modelName);
  if (!existing) {
    return;
  }
  replaceCollectionOptions(existing.routePath, options);
};

export const registerMCPTool = (tool: MCPCustomTool): void => {
  const existingIndex = mcpCustomTools.findIndex((registered) => registered.name === tool.name);
  if (existingIndex >= 0) {
    mcpCustomTools[existingIndex] = tool;
    return;
  }
  mcpCustomTools.push(tool);
};

export const getMCPRegistry = (): MCPRegistryEntry[] => {
  return listCollections()
    .filter((record) => record.surfaces.mcp)
    .map((record) => ({
      config: record.options.mcp as MCPConfig,
      model: record.model,
      modelName: record.model.modelName,
      options: record.options,
    }));
};

export const getMCPCustomTools = (): MCPCustomTool[] => {
  return mcpCustomTools;
};

export const clearMCPRegistry = (): void => {
  clearCollectionRegistry();
  mcpCustomTools.length = 0;
};
