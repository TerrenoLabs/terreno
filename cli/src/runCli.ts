import {runApiCommand} from "./commands/api";
import {runBootstrapCommand} from "./commands/bootstrap";
import {runDocsCommand} from "./commands/docs";
import {runGenerateCommand, runValidateCommand} from "./commands/generate";
import {
  runDbCommand,
  runEvalCommand,
  runInfoCommand,
  runLogsCommand,
  runNavigateCommand,
  runStateCommand,
} from "./commands/project";
import {runWebCommand} from "./commands/web";
import {commandHelp, HELP_TEXT} from "./help";
import {type CliIo, createProcessIo, printJson} from "./io";
import {flagBoolean, parseArgs} from "./parseArgs";
import {readCliVersion} from "./version";

export const runCli = async (argv: string[], io: CliIo = createProcessIo()): Promise<number> => {
  const parsed = parseArgs(argv);
  const json = flagBoolean(parsed.flags, "json");
  const command = parsed.positionals[0];

  if (flagBoolean(parsed.flags, "version", "v") && !command) {
    const version = await readCliVersion();
    if (json) {
      printJson(io, {name: "@terreno/cli", version});
    } else {
      io.stdout(version);
    }
    return 0;
  }

  if (!command || command === "help" || flagBoolean(parsed.flags, "help", "h")) {
    const topic = command === "help" ? parsed.positionals[1] : command;
    io.stdout(topic && topic !== "help" ? commandHelp(topic) : HELP_TEXT);
    return 0;
  }

  try {
    switch (command) {
      case "api":
        return await runApiCommand(parsed, io, json);
      case "bootstrap":
        return await runBootstrapCommand(parsed, io, json);
      case "db":
        return await runDbCommand(parsed, io, json);
      case "docs":
        return await runDocsCommand(parsed, io, json);
      case "eval":
        return await runEvalCommand(parsed, io, json);
      case "generate":
        return await runGenerateCommand(parsed, io, json);
      case "info":
        return await runInfoCommand(io, json);
      case "logs":
        return await runLogsCommand(parsed, io, json);
      case "navigate":
        return await runNavigateCommand(parsed, io, json);
      case "state":
        return await runStateCommand(parsed, io, json);
      case "validate":
        return await runValidateCommand(parsed, io, json);
      case "web":
        return await runWebCommand(parsed, io, json);
      case "version": {
        const version = await readCliVersion();
        io.stdout(version);
        return 0;
      }
      default:
        io.stderr(`Unknown command "${command}". Run terreno --help.`);
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      printJson(io, {error: message, ok: false});
    } else {
      io.stderr(message);
    }
    return 1;
  }
};
