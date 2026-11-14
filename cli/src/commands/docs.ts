import {getComponentDocsMarkdown, searchDocs} from "@terreno/mcp/search";
import {handleToolCall} from "@terreno/mcp/tools";
import {getUpgradeGuideMarkdown} from "@terreno/mcp/upgrade";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {printToolResult} from "../localTool";
import {flagBoolean, flagString, type ParsedArgs} from "../parseArgs";

const NOTES_USAGE = "Usage: terreno docs notes <search|get|ask> <query|id|question...>";

/** Update notes are the release and announcement notes behind the MCP `terreno_*_update_*` tools. */
const runNotesCommand = async (parsed: ParsedArgs, io: CliIo, json: boolean): Promise<number> => {
  const action = parsed.positionals[2];
  const text = parsed.positionals.slice(3).join(" ").trim();
  if (!text || (action !== "search" && action !== "get" && action !== "ask")) {
    io.stderr(NOTES_USAGE);
    return 1;
  }
  const includeArchived = flagBoolean(parsed.flags, "include-archived");
  const limitRaw = flagString(parsed.flags, "limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (action === "search") {
    return printToolResult(
      io,
      json,
      await handleToolCall("terreno_search_update_notes", {
        includeArchived,
        limit,
        queries: [text],
        source: flagString(parsed.flags, "source"),
      })
    );
  }
  if (action === "get") {
    return printToolResult(
      io,
      json,
      await handleToolCall("terreno_get_update_note", {id: text, includeArchived})
    );
  }
  return printToolResult(
    io,
    json,
    await handleToolCall("terreno_ask_update_help", {includeArchived, limit, question: text})
  );
};

export const runDocsCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const action = parsed.positionals[1];
  if (action === "search") {
    const query = parsed.positionals.slice(2).join(" ").trim();
    if (!query) {
      io.stderr("Usage: terreno docs search <query...>");
      return 1;
    }
    const packagesRaw = flagString(parsed.flags, "packages");
    const tokenLimitRaw = flagString(parsed.flags, "token-limit");
    const markdown = searchDocs({
      packages: packagesRaw
        ? packagesRaw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      queries: [query],
      tokenLimit: tokenLimitRaw ? Number(tokenLimitRaw) : undefined,
    });
    if (json) {
      printJson(io, {query, result: markdown});
    } else {
      io.stdout(markdown);
    }
    return 0;
  }

  if (action === "component") {
    const name = parsed.positionals[2];
    if (!name) {
      io.stderr("Usage: terreno docs component <Name>");
      return 1;
    }
    const markdown = getComponentDocsMarkdown(name);
    if (json) {
      printJson(io, {component: name, result: markdown});
    } else {
      io.stdout(markdown);
    }
    return 0;
  }

  if (action === "upgrade") {
    const fromVersion = flagString(parsed.flags, "from");
    const toVersion = flagString(parsed.flags, "to");
    if (!fromVersion || !toVersion) {
      io.stderr("Usage: terreno docs upgrade --from <semver> --to <semver>");
      return 1;
    }
    const markdown = getUpgradeGuideMarkdown(fromVersion, toVersion);
    if (json) {
      printJson(io, {fromVersion, result: markdown, toVersion});
    } else {
      io.stdout(markdown);
    }
    return 0;
  }

  if (action === "notes") {
    return runNotesCommand(parsed, io, json);
  }

  io.stderr("Usage: terreno docs <search|component|upgrade|notes>");
  return 1;
};
