import {afterEach, describe, it} from "bun:test";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {loadAnnouncementPack, runAnnouncementPackCli} from "./announcement-pack";

const EXAMPLE_PACK_DIRECTORY = join(import.meta.dir, "../../announcements/releases/1.14.0");

const VALID_MANIFEST = [
  "schema: terreno.announcement-pack/v1",
  "release:",
  "  product: example",
  '  version: "1.0.0"',
  "announcements:",
  "  - item.md",
].join("\n");

interface ReceivedRequest {
  authorization: string | null;
  body: {publish: boolean; announcements: Array<{slug: string}>};
}

const servers: Bun.Server<unknown>[] = [];

afterEach((): void => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const writePack = async ({
  item,
  manifest = VALID_MANIFEST,
}: {
  item?: string;
  manifest?: string;
}): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "announcement-pack-"));
  await writeFile(join(directory, "pack.yaml"), manifest);
  if (item !== undefined) {
    await writeFile(join(directory, "item.md"), item);
  }
  return directory;
};

const captureError = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to throw");
};

const startImportServer = ({
  received,
  status = 200,
}: {
  received: ReceivedRequest[];
  status?: number;
}): string => {
  const server = Bun.serve({
    fetch: async (request: Request): Promise<Response> => {
      received.push({
        authorization: request.headers.get("authorization"),
        body: (await request.json()) as ReceivedRequest["body"],
      });
      return Response.json({data: {created: 3}}, {status});
    },
    port: 0,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/`;
};

describe("loadAnnouncementPack", () => {
  it("parses the example 1.14.0 pack into a valid draft import body", async () => {
    const body = await loadAnnouncementPack({directory: EXAMPLE_PACK_DIRECTORY});

    assert.deepEqual(body.release, {
      buildNumber: 1842,
      channel: "production",
      product: "example",
      version: "1.14.0",
    });
    assert.isFalse(body.publish);
    assert.deepEqual(
      body.announcements.map((item) => item.slug),
      ["staff-required", "patient-banner", "changelog"]
    );

    const staff = body.announcements[0];
    assert.equal(staff?.displayMode, "modal");
    assert.equal(staff?.acknowledgementPolicy, "required");
    assert.equal(staff?.primaryAction?.label, "Read the release notes");
    assert.isTrue(staff?.body.startsWith("## What changed in 1.14.0"));
    assert.equal(body.defaults?.displayMode, "feed");
  });

  it("sets publish only when requested", async () => {
    const body = await loadAnnouncementPack({directory: EXAMPLE_PACK_DIRECTORY, publish: true});
    assert.isTrue(body.publish);
  });

  it("rejects malformed packs", async () => {
    const wrongSchema = await writePack({manifest: "schema: other/v1\nannouncements: []"});
    const missingList = await writePack({manifest: "schema: terreno.announcement-pack/v1"});
    const noFrontmatter = await writePack({item: "Just a body"});
    const listFrontmatter = await writePack({item: "---\n- one\n---\nBody\n"});
    const badSlug = await writePack({item: "---\nslug: Not A Slug\ntitle: Bad\n---\nBody\n"});

    assert.include(
      (await captureError(() => loadAnnouncementPack({directory: wrongSchema}))).message,
      "terreno.announcement-pack/v1"
    );
    assert.include(
      (await captureError(() => loadAnnouncementPack({directory: missingList}))).message,
      "list of Markdown file names"
    );
    assert.include(
      (await captureError(() => loadAnnouncementPack({directory: noFrontmatter}))).message,
      "must start with YAML frontmatter"
    );
    assert.include(
      (await captureError(() => loadAnnouncementPack({directory: listFrontmatter}))).message,
      "frontmatter must be a YAML object"
    );
    assert.instanceOf(await captureError(() => loadAnnouncementPack({directory: badSlug})), Error);
  });
});

describe("runAnnouncementPackCli", () => {
  it("prints the import body when no upload URL is given", async () => {
    const outputs: string[] = [];
    await runAnnouncementPackCli({
      args: [EXAMPLE_PACK_DIRECTORY],
      write: (output) => outputs.push(output),
    });

    const printed = JSON.parse(outputs.join("")) as ReceivedRequest["body"];
    assert.lengthOf(printed.announcements, 3);
    assert.isFalse(printed.publish);
  });

  it("uploads with the bearer token and --publish", async () => {
    const received: ReceivedRequest[] = [];
    const apiUrl = startImportServer({received});
    const outputs: string[] = [];

    await runAnnouncementPackCli({
      args: [EXAMPLE_PACK_DIRECTORY, "--publish", "--upload", apiUrl],
      write: (output) => outputs.push(output),
    });

    assert.lengthOf(received, 1);
    assert.match(received[0]?.authorization ?? "", /^Bearer .+/);
    assert.isTrue(received[0]?.body.publish);
    assert.deepEqual(JSON.parse(outputs.join("")), {data: {created: 3}});
  });

  it("throws when the upload is rejected", async () => {
    const apiUrl = startImportServer({received: [], status: 401});
    const error = await captureError(() =>
      runAnnouncementPackCli({args: [EXAMPLE_PACK_DIRECTORY, "--upload", apiUrl], write: () => {}})
    );
    assert.include(error.message, "Upload failed with 401");
  });

  it("prints usage when arguments are missing", async () => {
    const missingDirectory = await captureError(() =>
      runAnnouncementPackCli({args: [], write: () => {}})
    );
    const missingUrl = await captureError(() =>
      runAnnouncementPackCli({args: [EXAMPLE_PACK_DIRECTORY, "--upload"], write: () => {}})
    );

    assert.include(missingDirectory.message, "Usage:");
    assert.include(missingUrl.message, "Usage:");
  });
});
