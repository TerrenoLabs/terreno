#!/usr/bin/env bun

import {createProcessIo} from "./io";
import {runCli} from "./runCli";

interface MainOptions {
  argv?: string[];
  exit?: (code: number) => void;
}

export const main = async ({
  argv = process.argv.slice(2),
  exit = process.exit,
}: MainOptions = {}): Promise<void> => {
  const code = await runCli(argv, createProcessIo());
  exit(code);
};

if (import.meta.main) {
  await main();
}
