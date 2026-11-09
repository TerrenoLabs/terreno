import type {CliIo} from "../io";
import {flagBoolean, parseArgs} from "../parseArgs";
import {parseOpenApiDocument} from "./loadSpec";
import {runRestCommand} from "./runRestCommand";

export interface RunAppRestCliOptions {
  argv: string[];
  binName: string;
  defaultBaseUrl?: string;
  specText: string;
  title: string;
}

const helpFor = (binName: string, title: string): string => {
  return `Usage: ${binName} <list|call|request> [options]

OpenAPI CLI for ${title}

  list
  call <operationId> [--param name=value] [--body json]
  request <METHOD> <path> [--param name=value] [--body json]

Options:
  --base-url <url>
  --token <token>
  --header "Name: value"
  --body-file <path>
  --json
`;
};

export const runAppRestCli = async (options: RunAppRestCliOptions): Promise<number> => {
  const parsed = parseArgs(options.argv);
  const wantsHelp = flagBoolean(parsed.flags, "help", "h");
  if (wantsHelp || parsed.positionals.length === 0) {
    console.info(helpFor(options.binName, options.title));
    return wantsHelp ? 0 : 1;
  }

  const spec = parseOpenApiDocument(options.specText);
  const io: CliIo = {
    cwd: process.cwd(),
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    stderr: (line: string): void => console.error(line),
    stdout: (line: string): void => console.info(line),
  };
  return runRestCommand({
    defaultBaseUrl: options.defaultBaseUrl,
    io,
    parsed,
    spec,
  });
};
