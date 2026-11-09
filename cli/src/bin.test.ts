import {describe, it} from "bun:test";
import {assert} from "chai";

import {main} from "./bin";

describe("CLI entry point", () => {
  it("runs parsed arguments and exits with the command status", async (): Promise<void> => {
    let exitCode: number | undefined;

    await main({
      argv: ["--help"],
      exit: (code): void => {
        exitCode = code;
      },
    });

    assert.equal(exitCode, 0);
  });
});
