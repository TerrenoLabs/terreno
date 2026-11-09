import {describe, it} from "bun:test";
import {assert} from "chai";

import * as cli from "./index";

describe("@terreno/cli exports", () => {
  it("exposes the CLI and OpenAPI integration surface", (): void => {
    assert.isFunction(cli.createProcessIo);
    assert.isFunction(cli.defaultBaseUrl);
    assert.isFunction(cli.findRestOperation);
    assert.isFunction(cli.generateRestCliFiles);
    assert.isFunction(cli.invokeRestOperation);
    assert.isFunction(cli.listRestOperations);
    assert.isFunction(cli.loadOpenApiDocument);
    assert.isFunction(cli.parseArgs);
    assert.isFunction(cli.parseOpenApiDocument);
    assert.isFunction(cli.runAppRestCli);
    assert.isFunction(cli.runCli);
    assert.isFunction(cli.sanitizeOperationId);
  });
});
