import type {Tool} from "@modelcontextprotocol/server";

import {applicationInfo} from "./tools/applicationInfo.js";
import {isBrowserAction, useBrowser} from "./tools/browser.js";
import {databaseQuery} from "./tools/databaseQuery.js";
import {databaseSchema} from "./tools/databaseSchema.js";
import {lastError, readLogs} from "./tools/readLogs.js";
import {evaluate, navigate} from "./tools/runtime.js";
import {getSyncDbState, syncDbAction, syncDbSnapshot} from "./tools/syncDb.js";

const SYNCDB_STATE_INPUT_SCHEMA: Tool["inputSchema"] = {
  additionalProperties: false,
  properties: {
    collection: {description: "SyncDB: optional collection filter", type: "string"},
    entityId: {description: "SyncDB: optional entity id filter", type: "string"},
    includeDebugEvents: {
      description: "SyncDB: set false to return debug stats without event bodies",
      type: "boolean",
    },
    limit: {
      description: "SyncDB: entity limit per collection (default 500, max 2000)",
      type: "number",
    },
    name: {
      description: "SyncDB: client/store name; defaults to the first registered client",
      type: "string",
    },
  },
  type: "object",
};

export const localMcpTools: Tool[] = [
  {
    description:
      "Read the consumer app's package.json workspaces and key dependency versions (@terreno/*, Expo, React Native, Mongoose). Looks in `backend/` or `example-backend/`, and `frontend/` or `example-frontend/`. Call at the start of each chat and write version-specific code (Boost-style).",
    inputSchema: {additionalProperties: false, properties: {}, type: "object"},
    name: "application_info",
  },
  {
    description:
      "List Mongo collections with indexes and counts, plus static excerpts from `backend/src/models/*.ts`. Uses `MONGO_URI` from `backend/.env` or environment.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        collectionFilter: {description: "Substring filter for collection names", type: "string"},
        summary: {description: "When true, omit long model file excerpts", type: "boolean"},
      },
      type: "object",
    },
    name: "database_schema",
  },
  {
    description:
      "Read-only Mongo: find, aggregate (no $out/$merge/$function), countDocuments, distinct. Result cap default 50, max 200.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        collection: {type: "string"},
        field: {type: "string"},
        filter: {additionalProperties: true, type: "object"},
        limit: {type: "number"},
        operation: {
          enum: ["find", "aggregate", "countDocuments", "distinct"],
          type: "string",
        },
        pipeline: {
          items: {additionalProperties: true, type: "object"},
          type: "array",
        },
      },
      required: ["collection", "operation"],
      type: "object",
    },
    name: "database_query",
  },
  {
    description:
      "Merged log tail from `.terreno/logs/app.log` (backend JSONL), `.terreno/logs/browser.log`, Metro `/events`, and Hermes console via CDP when Metro is reachable.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        entries: {type: "number"},
        level: {type: "string"},
        since: {
          description:
            "ISO-8601 timestamp; omit entries strictly before this instant when timestamps exist.",
          type: "string",
        },
        sources: {items: {type: "string"}, type: "array"},
      },
      type: "object",
    },
    name: "read_logs",
  },
  {
    description: "Most recent error-level JSONL line from backend/browser dev logs.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        sources: {items: {type: "string"}, type: "array"},
      },
      type: "object",
    },
    name: "last_error",
  },
  {
    description:
      "Inspect a live SyncDB client registered by createSyncDb({debug: true}): status, entities (including tombstones/pending metadata), decoded outbox, conflicts, cursors, streams, repairs, values, and debugger events. Sensitive fields are redacted.",
    inputSchema: SYNCDB_STATE_INPUT_SCHEMA,
    name: "get_syncdb_state",
  },
  {
    description:
      "Change a live SyncDB client (requires TERRENO_MCP_EVAL=1): mutate, directly edit local rows, flush the outbox, reconcile/resync, resolve conflicts, retry failures, toggle offline, clear debug events, or merge a captured snapshot.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: [
            "mutate",
            "setLocalEntity",
            "deleteLocalEntity",
            "flush",
            "reconcile",
            "forceResync",
            "resolveConflict",
            "retryFailed",
            "goOffline",
            "goOnline",
            "clearDebug",
            "mergeSnapshot",
          ],
          type: "string",
        },
        collection: {type: "string"},
        data: {additionalProperties: true, type: "object"},
        deleted: {type: "boolean"},
        entityId: {type: "string"},
        id: {type: "string"},
        maxAttempts: {type: "number"},
        mutationId: {type: "string"},
        name: {type: "string"},
        operation: {enum: ["create", "update", "delete"], type: "string"},
        seq: {type: "number"},
        snapshotId: {type: "string"},
        strategy: {enum: ["useServer", "keepMine"], type: "string"},
        stream: {type: "string"},
      },
      required: ["action"],
      type: "object",
    },
    name: "syncdb_action",
  },
  {
    description:
      "Capture, list, read, compare, or delete in-memory SyncDB snapshots. Captures include the full mergeable TinyBase content for later mergeSnapshot, while returned state redacts sensitive fields.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        action: {enum: ["capture", "list", "get", "compare", "delete"], type: "string"},
        collection: {type: "string"},
        entityId: {type: "string"},
        includeDebugEvents: {type: "boolean"},
        limit: {type: "number"},
        name: {type: "string"},
        otherSnapshotId: {type: "string"},
        snapshotId: {type: "string"},
      },
      required: ["action"],
      type: "object",
    },
    name: "syncdb_snapshot",
  },
  {
    description:
      "Opt-in Hermes Runtime.evaluate over Metro CDP (gated by TERRENO_MCP_EVAL=1). Hermes allows a single debugger connection.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        code: {type: "string"},
      },
      required: ["code"],
      type: "object",
    },
    name: "evaluate",
  },
  {
    description:
      "expo-router navigate/push via CDP (gated by TERRENO_MCP_EVAL=1). Same Hermes connection as evaluate/logs.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        path: {type: "string"},
      },
      required: ["path"],
      type: "object",
    },
    name: "navigate",
  },
  {
    description:
      "Drive the web app with Bun 1.4's built-in headless WebView. Open a persistent session, click/type/press/scroll, inspect the rendered page, save screenshots, then close it. Use snapshot and screenshot as proof after exercising a changed flow.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        action: {
          enum: [
            "open",
            "click",
            "type",
            "press",
            "scroll",
            "evaluate",
            "snapshot",
            "screenshot",
            "back",
            "forward",
            "reload",
            "wait",
            "close",
          ],
          type: "string",
        },
        code: {description: "JavaScript expression for evaluate", type: "string"},
        dataDir: {description: "Optional persistent browser-profile directory", type: "string"},
        height: {description: "Viewport height for open", type: "number"},
        key: {description: "Key name for press", type: "string"},
        modifiers: {
          items: {enum: ["Shift", "Control", "Alt", "Meta"], type: "string"},
          type: "array",
        },
        output: {description: "Screenshot path (.png, .jpg, or .webp)", type: "string"},
        quality: {description: "JPEG/WebP quality from 0 to 100", type: "number"},
        selector: {description: "CSS selector for click, type, or scroll", type: "string"},
        text: {description: "Text inserted by type", type: "string"},
        timeout: {description: "Selector wait timeout in milliseconds", type: "number"},
        url: {description: "URL for open", type: "string"},
        width: {description: "Viewport width for open", type: "number"},
        x: {description: "Horizontal pixel delta for scroll", type: "number"},
        y: {description: "Vertical pixel delta for scroll", type: "number"},
      },
      required: ["action"],
      type: "object",
    },
    name: "browser",
  },
];

export const createLocalToolCallHandler = (
  browserRunner: typeof useBrowser = useBrowser
): ((
  name: string,
  args: Record<string, unknown>
) => Promise<{content: Array<{type: "text"; text: string}>}>) => {
  return async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{content: Array<{type: "text"; text: string}>}> => {
    switch (name) {
      case "application_info": {
        return {content: [{text: applicationInfo(), type: "text"}]};
      }
      case "database_schema": {
        const text = await databaseSchema({
          collectionFilter:
            typeof args.collectionFilter === "string" ? args.collectionFilter : undefined,
          summary: typeof args.summary === "boolean" ? args.summary : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "database_query": {
        const text = await databaseQuery({
          collection: typeof args.collection === "string" ? args.collection : "",
          field: typeof args.field === "string" ? args.field : undefined,
          filter:
            typeof args.filter === "object" && args.filter !== null
              ? (args.filter as Record<string, unknown>)
              : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          operation: typeof args.operation === "string" ? args.operation : "",
          pipeline: Array.isArray(args.pipeline) ? (args.pipeline as unknown[]) : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "read_logs": {
        const text = await readLogs({
          entries: typeof args.entries === "number" ? args.entries : undefined,
          level: typeof args.level === "string" ? args.level : undefined,
          since: typeof args.since === "string" ? args.since : undefined,
          sources: Array.isArray(args.sources)
            ? args.sources.filter((s): s is string => typeof s === "string")
            : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "last_error": {
        const text = await lastError({
          sources: Array.isArray(args.sources)
            ? args.sources.filter((s): s is string => typeof s === "string")
            : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "get_syncdb_state": {
        const text = await getSyncDbState({
          collection: typeof args.collection === "string" ? args.collection : undefined,
          entityId: typeof args.entityId === "string" ? args.entityId : undefined,
          includeDebugEvents:
            typeof args.includeDebugEvents === "boolean" ? args.includeDebugEvents : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "syncdb_action": {
        const text = await syncDbAction({
          action: typeof args.action === "string" ? args.action : "",
          collection: typeof args.collection === "string" ? args.collection : undefined,
          data:
            typeof args.data === "object" && args.data !== null
              ? (args.data as Record<string, unknown>)
              : undefined,
          deleted: typeof args.deleted === "boolean" ? args.deleted : undefined,
          entityId: typeof args.entityId === "string" ? args.entityId : undefined,
          id: typeof args.id === "string" ? args.id : undefined,
          maxAttempts: typeof args.maxAttempts === "number" ? args.maxAttempts : undefined,
          mutationId: typeof args.mutationId === "string" ? args.mutationId : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
          operation: typeof args.operation === "string" ? args.operation : undefined,
          seq: typeof args.seq === "number" ? args.seq : undefined,
          snapshotId: typeof args.snapshotId === "string" ? args.snapshotId : undefined,
          strategy: typeof args.strategy === "string" ? args.strategy : undefined,
          stream: typeof args.stream === "string" ? args.stream : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "syncdb_snapshot": {
        const text = await syncDbSnapshot({
          action: typeof args.action === "string" ? args.action : "",
          collection: typeof args.collection === "string" ? args.collection : undefined,
          entityId: typeof args.entityId === "string" ? args.entityId : undefined,
          includeDebugEvents:
            typeof args.includeDebugEvents === "boolean" ? args.includeDebugEvents : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
          otherSnapshotId:
            typeof args.otherSnapshotId === "string" ? args.otherSnapshotId : undefined,
          snapshotId: typeof args.snapshotId === "string" ? args.snapshotId : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      case "evaluate": {
        const text = await evaluate({code: typeof args.code === "string" ? args.code : ""});
        return {content: [{text, type: "text"}]};
      }
      case "navigate": {
        const text = await navigate({path: typeof args.path === "string" ? args.path : ""});
        return {content: [{text, type: "text"}]};
      }
      case "browser": {
        if (!isBrowserAction(args.action)) {
          throw new Error(`Unknown or missing browser action: ${String(args.action)}`);
        }
        const text = await browserRunner({
          action: args.action,
          code: typeof args.code === "string" ? args.code : undefined,
          dataDir: typeof args.dataDir === "string" ? args.dataDir : undefined,
          height: typeof args.height === "number" ? args.height : undefined,
          key: typeof args.key === "string" ? args.key : undefined,
          modifiers: Array.isArray(args.modifiers)
            ? args.modifiers.filter(
                (modifier): modifier is Bun.WebView.Modifier =>
                  modifier === "Shift" ||
                  modifier === "Control" ||
                  modifier === "Alt" ||
                  modifier === "Meta"
              )
            : undefined,
          output: typeof args.output === "string" ? args.output : undefined,
          quality: typeof args.quality === "number" ? args.quality : undefined,
          selector: typeof args.selector === "string" ? args.selector : undefined,
          text: typeof args.text === "string" ? args.text : undefined,
          timeout: typeof args.timeout === "number" ? args.timeout : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
          width: typeof args.width === "number" ? args.width : undefined,
          x: typeof args.x === "number" ? args.x : undefined,
          y: typeof args.y === "number" ? args.y : undefined,
        });
        return {content: [{text, type: "text"}]};
      }
      default: {
        return {content: [{text: `Unknown tool: ${name}`, type: "text"}]};
      }
    }
  };
};

export const handleLocalToolCall = createLocalToolCallHandler();
