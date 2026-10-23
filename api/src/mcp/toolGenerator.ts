import {toJSONSchema, type ZodType} from "zod";

import type {User} from "../auth";
import {listCollections} from "../collectionRegistry";
import {APIError} from "../errors";
import {generateActionTools} from "./actionTools";
import {handleCreate, handleDelete, handleList, handleRead, handleUpdate} from "./handlers";
import {getMCPCustomTools, getMCPRegistry} from "./registry";
import {
  generateInputSchema,
  generateToolDescription,
  restWriteExcludeFields,
} from "./schemaGenerator";
import {executeTool} from "./toolExecution";
import type {
  MCPMethod,
  MCPRegistryEntry,
  MCPToolArgs,
  MCPToolInputSchema,
  MCPToolResult,
} from "./types";

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  zodSchema: ZodType;
  handler: (args: MCPToolArgs, user?: User) => Promise<MCPToolResult>;
}

const getToolPrefix = (entry: MCPRegistryEntry): string => {
  if (entry.config.toolPrefix) {
    return entry.config.toolPrefix;
  }
  // Default: lowercase model name with simple pluralization. Irregular nouns are expected
  // to set config.toolPrefix rather than growing an exception list here.
  const name = entry.modelName.toLowerCase();
  if (/(?:s|x|z|ch|sh)$/.test(name)) {
    return `${name}es`;
  }
  if (name.endsWith("y") && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
};

const METHOD_HANDLERS: Record<
  MCPMethod,
  (entry: MCPRegistryEntry, args: MCPToolArgs, user?: User) => Promise<MCPToolResult>
> = {
  create: handleCreate,
  delete: handleDelete,
  list: handleList,
  read: handleRead,
  update: handleUpdate,
};

export const generateToolsForEntry = (entry: MCPRegistryEntry): MCPToolDefinition[] => {
  const methods = entry.config.methods ?? ["list", "read"];
  const prefix = getToolPrefix(entry);
  const tools: MCPToolDefinition[] = [];

  for (const method of methods) {
    // Skip methods with empty permission arrays (disabled)
    if (entry.options.permissions[method]?.length === 0) {
      continue;
    }

    const restExcludeFields = restWriteExcludeFields(method, entry.options.validation);
    const zodSchema = generateInputSchema(
      entry.model,
      method,
      entry.config,
      entry.options.queryFields,
      entry.options.populatePaths,
      restExcludeFields
    );

    const inputSchema = toJSONSchema(zodSchema);

    const handler = METHOD_HANDLERS[method];
    const toolName = `${prefix}_${method}`;

    tools.push({
      description: generateToolDescription(
        entry.model,
        method,
        entry.config,
        entry.options.queryFields,
        entry.options.populatePaths,
        restExcludeFields
      ),
      handler: (args: MCPToolArgs, user?: User) =>
        executeTool({
          labels: {mcpMethod: method, mcpModel: entry.modelName, mcpTool: toolName},
          run: () => handler(entry, args, user),
          user,
        }),
      inputSchema: inputSchema as MCPToolInputSchema,
      name: toolName,
      zodSchema,
    });
  }

  return tools;
};

export const generateAllTools = (entries: MCPRegistryEntry[]): MCPToolDefinition[] => {
  const tools: MCPToolDefinition[] = [];
  for (const entry of entries) {
    tools.push(...generateToolsForEntry(entry));
  }
  return tools;
};

/**
 * Model-router CRUD tools, modelRouter actions that opted in with `mcp`, and custom tools
 * registered with `registerMCPTool`.
 */
export const getAllMCPTools = (): MCPToolDefinition[] => {
  const customTools: MCPToolDefinition[] = getMCPCustomTools().map((tool) => {
    return {
      description: tool.description,
      handler: tool.handler,
      inputSchema: toJSONSchema(tool.zodSchema) as MCPToolInputSchema,
      name: tool.name,
      zodSchema: tool.zodSchema,
    };
  });
  const baseTools = [...generateAllTools(getMCPRegistry()), ...customTools];
  const actionTools = generateActionTools(listCollections());
  const takenNames = new Set(baseTools.map((tool) => tool.name));
  for (const tool of actionTools) {
    if (takenNames.has(tool.name)) {
      throw new APIError({
        status: 500,
        title: `MCP tool name "${tool.name}" is used by more than one tool. Give the action a unique mcp.name.`,
      });
    }
    takenNames.add(tool.name);
  }
  return [...baseTools, ...actionTools];
};
