import {getComponentDocsMarkdown, searchDocs} from "@terreno/mcp/search";
import {getUpgradeGuideMarkdown} from "@terreno/mcp/upgrade";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {flagString, type ParsedArgs} from "../parseArgs";

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

  io.stderr("Usage: terreno docs <search|component|upgrade>");
  return 1;
};
