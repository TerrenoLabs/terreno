import {isAbsolute, join} from "node:path";
import {generateAiRulesFiles} from "@terreno/mcp/bootstrap";
import {generateAllFiles} from "create-terreno-app";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {
  type LinkTerrenoOptions,
  type LinkTerrenoPlan,
  linkTerreno,
  prepareLinkTerreno,
} from "../linkTerreno";
import {flagString, type ParsedArgs} from "../parseArgs";
import {writeFiles} from "../writeFiles";

const resolveFromCwd = (cwd: string, value: string): string => {
  if (isAbsolute(value)) {
    return value;
  }
  return join(cwd, value);
};

const parsePackages = (raw: string | undefined): string[] | undefined => {
  if (!raw) {
    return undefined;
  }
  const packages = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return packages.length > 0 ? packages : undefined;
};

export const runBootstrapCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean,
  pack?: LinkTerrenoOptions["pack"]
): Promise<number> => {
  const action = parsed.positionals[1];
  const name = flagString(parsed.flags, "name");
  const displayName = flagString(parsed.flags, "display-name") ?? name;
  const dest = flagString(parsed.flags, "dir") ?? io.cwd;
  if (!name || !displayName) {
    io.stderr("Usage: terreno bootstrap <app|rules> --name <kebab> --display-name <title>");
    return 1;
  }
  const root = resolveFromCwd(io.cwd, dest);

  if (action === "app") {
    const checkoutFlag = parsed.flags["terreno-path"];
    const checkout = flagString(parsed.flags, "terreno-path");
    if (checkoutFlag !== undefined && (!checkout || checkout.trim().length === 0)) {
      io.stderr("--terreno-path requires a non-empty checkout path.");
      return 1;
    }
    const files = generateAllFiles({
      appDisplayName: displayName,
      appName: name,
      description: flagString(parsed.flags, "description"),
      mcpServerUrl: flagString(parsed.flags, "mcp-url"),
    });
    let plan: LinkTerrenoPlan | undefined;
    if (checkout) {
      try {
        plan = await prepareLinkTerreno({
          checkout: resolveFromCwd(io.cwd, checkout),
          files,
        });
      } catch (error) {
        io.stderr(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    await writeFiles(root, files);
    const linkedPackages = plan ? await linkTerreno({appRoot: root, pack, plan}) : [];
    if (json) {
      printJson(io, {files: files.map((file) => file.path), linkedPackages, ok: true, path: root});
    } else {
      io.stdout(`Wrote ${String(files.length)} files to ${root}`);
      if (linkedPackages.length > 0) {
        io.stdout(`Linked Terreno packages: ${linkedPackages.join(", ")}`);
      }
    }
    return 0;
  }

  if (action === "rules") {
    const files = generateAiRulesFiles({
      appDisplayName: displayName,
      appName: name,
      packages: parsePackages(flagString(parsed.flags, "packages")),
    });
    await writeFiles(root, files);
    if (json) {
      printJson(io, {files: files.map((file) => file.path), ok: true, path: root});
    } else {
      io.stdout(`Wrote ${String(files.length)} files to ${root}`);
    }
    return 0;
  }

  io.stderr("Usage: terreno bootstrap <app|rules>");
  return 1;
};
