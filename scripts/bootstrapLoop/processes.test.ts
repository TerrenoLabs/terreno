import {describe, expect, it} from "bun:test";

import {stopRunProcesses} from "./processes";

describe("stopRunProcesses", () => {
  it("stops processes by cwd or command line inside the run dir and nothing else", () => {
    const killed: number[] = [];
    const stopped = stopRunProcesses({
      kill: (pid) => killed.push(pid),
      list: () => [
        {command: "bun run --watch src/index.ts", cwd: "/runs/a/app/backend", pid: 101},
        {command: "mongod --dbpath /runs/a/app/.mongo --fork", cwd: "/", pid: 102},
        {command: "mongod --dbpath /runs/ab/app/.mongo", cwd: "/", pid: 103},
        {command: "bun test", cwd: "/Users/someone/src/other", pid: 104},
        {command: "self", cwd: "/runs/a/app", pid: process.pid},
      ],
      runDir: "/runs/a",
    });
    expect(stopped).toEqual([101, 102]);
    expect(killed).toEqual([101, 102]);
  });
});
