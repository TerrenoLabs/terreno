/**
 * Terreno CI spike: the same lint/compile/test steps CI runs, runnable locally
 * (`dagger call example-backend-test`) or from any CI host.
 */
import {
  argument,
  type Container,
  dag,
  type Directory,
  func,
  object,
  type Service,
} from "@dagger.io/dagger";

const BUN_IMAGE = "oven/bun:1.4.4";
const MONGO_IMAGE = "mirror.gcr.io/library/mongo:6.0";

const MONGO_URI = "mongodb://mongo:27017/terreno-example-test";

const SOURCE_IGNORE = [
  "**/node_modules",
  "**/dist",
  "**/.expo",
  ".git",
  ".terreno",
  "**/*.log",
  "dagger/sdk",
];

@object()
export class TerrenoCi {
  /** Bun base with the workspace installed from the frozen lockfile. */
  @func()
  base(
    @argument({defaultPath: "/", ignore: SOURCE_IGNORE}) source: Directory,
  ): Container {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-install-cache"))
      .withDirectory("/app", source)
      .withWorkdir("/app")
      .withExec(["bun", "install", "--frozen-lockfile"]);
  }

  /** Disposable MongoDB for tests that need a real server. */
  @func()
  mongo(): Service {
    return dag.container().from(MONGO_IMAGE).withExposedPort(27017).asService({useEntrypoint: true});
  }

  /** Compile the workspace packages example-backend depends on. */
  @func()
  exampleBackendBuilt(
    @argument({defaultPath: "/", ignore: SOURCE_IGNORE}) source: Directory,
  ): Container {
    return this.base(source)
      .withExec(["bun", ".github/scripts/compile-workspace-deps.js", "example-backend"])
      .withExec(["bun", "run", "--filter", "@terreno/admin-spa", "compile"]);
  }

  /** Biome lint for example-backend. */
  @func()
  async exampleBackendLint(
    @argument({defaultPath: "/", ignore: SOURCE_IGNORE}) source: Directory,
  ): Promise<string> {
    return this.exampleBackendBuilt(source)
      .withWorkdir("/app/example-backend")
      .withExec(["bun", "run", "lint"])
      .stdout();
  }

  /** Typecheck example-backend. */
  @func()
  async exampleBackendCompile(
    @argument({defaultPath: "/", ignore: SOURCE_IGNORE}) source: Directory,
  ): Promise<string> {
    return this.exampleBackendBuilt(source)
      .withWorkdir("/app/example-backend")
      .withExec(["bun", "run", "compile"])
      .stdout();
  }

  /** Run example-backend tests against a Mongo service. */
  @func()
  async exampleBackendTest(
    @argument({defaultPath: "/", ignore: SOURCE_IGNORE}) source: Directory,
  ): Promise<string> {
    // A few suites start their own in-memory replica set. mongodb-memory-server cannot download a
    // linux-arm64 Debian 12 build, so hand it the mongod binary from the Mongo image instead.
    const mongod = dag.container().from(MONGO_IMAGE).file("/usr/bin/mongod");
    return this.exampleBackendBuilt(source)
      .withExec(["sh", "-c", "apt-get update -qq && apt-get install -y -qq libcurl4 libssl3 >/dev/null"])
      .withFile("/usr/local/bin/mongod", mongod, {permissions: 0o755})
      .withEnvVariable("MONGOMS_SYSTEM_BINARY", "/usr/local/bin/mongod")
      .withEnvVariable("MONGOMS_VERSION", "6.0.0")
      .withServiceBinding("mongo", this.mongo())
      .withEnvVariable("CI", "true")
      .withEnvVariable("TERRENO_TEST_MONGODB_URI", MONGO_URI)
      .withWorkdir("/app/example-backend")
      .withExec(["bun", "run", "test"])
      .stdout();
  }
}
