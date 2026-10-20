import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React from "react";

import {type ApiClient, createApiClient, type FetchLike} from "../api/client";
import {ApiClientProvider} from "../react/apiHooks";
import {discoverOperations} from "./discoverOperations";
import {emitApi} from "./emitApi";
import {generateApiSdk} from "./generate";
import {loadSpec} from "./loadSpec";

const FIXTURE = resolve(import.meta.dir, "fixtures/openapi.api.json");
const REACT_ENTRY = resolve(import.meta.dir, "../react/index.ts");
const API_ENTRY = resolve(import.meta.dir, "../api/client.ts");

let workDir: string;
let sdkPath: string;
let source: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "syncdb-api-codegen-"));
  sdkPath = join(workDir, "apiSdk.ts");
  source = await generateApiSdk({
    config: {apiImportPath: API_ENTRY, sdkImportPath: REACT_ENTRY},
    format: false,
    out: sdkPath,
    schema: FIXTURE,
  });
});

afterAll(async () => {
  await rm(workDir, {force: true, recursive: true});
});

describe("discoverOperations", () => {
  it("names every non-synced operation the way RTK codegen did and skips synced CRUD", async () => {
    const spec = await loadSpec(FIXTURE);

    const names = discoverOperations({spec}).map((operation) => operation.name);

    expect(names.sort()).toEqual([
      "getAuthMe",
      "getFilesByGcsKey",
      "getFlagsCurrent",
      "getGptDatasetsById",
      "getGptHistories",
      "getLabels",
      "getVersionCheck",
      "patchAuthMe",
      "postAdminMigrationsRun",
      "postAuthForgotPassword",
      "postFilesUpload",
      "postNotesImport",
      "revokeMcpServiceToken",
      "todosMarkComplete",
    ]);
  });

  it("rejects a declared path param the path does not contain", () => {
    const spec = {
      paths: {"/a": {get: {parameters: [{in: "path", name: "id"}], responses: {}}}},
    };

    expect(() => discoverOperations({spec})).toThrow(/declares path param "id"/);
  });

  it("rejects two operations that would generate the same hook name", () => {
    const spec = {
      paths: {
        "/a_b": {get: {responses: {}}},
        "/a-b": {get: {responses: {}}},
      },
    };

    expect(() => discoverOperations({spec})).toThrow(/getAB/);
  });
});

describe("emitted types", () => {
  it("flattens single arguments and groups the rest like RTK codegen flattenArg", () => {
    expect(source).toContain("export type GetAuthMeArgs = void;");
    expect(source).toContain("export type TodosMarkCompleteArgs = string;");
    expect(source).toContain("export type PostFilesUploadArgs = FormData;");
    expect(source).toMatch(/export type PostAuthForgotPasswordArgs = \{\s*email: string;\s*\};/);
    expect(source).toMatch(
      /export type GetGptDatasetsByIdArgs = \{\s*id: string;\s*historyId: string;\s*\};/
    );
    expect(source).toMatch(
      /export type GetGptHistoriesArgs = \{\s*limit\?: number;\s*page\?: number;\s*sort\?: string;\s*\};/
    );
  });

  it("makes a lone optional query param or optional body an optional argument", () => {
    expect(source).toContain(
      'export type PostAdminMigrationsRunArgs = "true" | "false" | undefined;'
    );
    expect(source).toContain(
      "export const postAdminMigrationsRunRequest = (arg?: PostAdminMigrationsRunArgs)"
    );
    expect(source).toMatch(
      /export type PostNotesImportArgs =\s*\|?\s*\{\s*source\?: string;\s*\}\s*\| undefined;/
    );
  });

  it("parenthesizes unions inside arrays and intersections", () => {
    expect(source).toContain("items?: (Tag | string)[];");
    expect(source).toContain("owner?: Owner & (Tag | string);");
  });

  it("rejects component schemas whose sanitized names collide", () => {
    const spec = {
      components: {schemas: {"Foo-Bar": {type: "string"}, "Foo.Bar": {type: "number"}}},
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                content: {"application/json": {schema: {$ref: "#/components/schemas/Foo-Bar"}}},
              },
            },
          },
        },
        "/b": {
          get: {
            responses: {
              "200": {
                content: {"application/json": {schema: {$ref: "#/components/schemas/Foo.Bar"}}},
              },
            },
          },
        },
      },
    };

    expect(() => emitApi({operations: discoverOperations({spec}), spec})).toThrow(
      /both become the type name "FooBar"/
    );
  });

  it("types responses after the client's envelope unwrapping", () => {
    expect(source).toContain("export type GetAuthMeRes = Profile;");
    expect(source).toContain("export type TodosMarkCompleteRes = Todo;");
    expect(source).toMatch(/export type GetGptHistoriesRes = \{[\s\S]*more\?: boolean;[\s\S]*\};/);
    expect(source).toContain("export type RevokeMcpServiceTokenRes = null;");
    expect(source).toContain("export type PostAuthForgotPasswordRes = unknown;");
    // A falsy `data` stays wrapped at runtime, so the type admits both shapes.
    expect(source).toMatch(/export type GetFlagsCurrentRes = boolean \| \{\s*data: boolean;\s*\};/);
    expect(source).toMatch(/export interface Profile \{[\s\S]*roles\?: string\[\];[\s\S]*\}/);
  });
});

describe("generated hooks", () => {
  interface Call {
    method: string;
    url: string;
    body: unknown;
  }

  const fakeBackend = (): {client: ApiClient; calls: Call[]} => {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({body: init?.body, method: init?.method ?? "GET", url: input});
      const path = new URL(input).pathname;
      const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
      if (path === "/todos/t%201/markComplete") {
        return json({data: {_id: "t 1", completed: true, title: "Ship it"}});
      }
      if (path === "/version-check") {
        return json({status: "ok"});
      }
      if (path === "/files/upload") {
        return json({mimeType: "text/plain", url: "gs://bucket/a.txt"});
      }
      return json({columns: ["a"], rows: [[1]]});
    };
    return {calls, client: createApiClient({baseUrl: "http://api.test", fetchImpl})};
  };

  const wrapperFor =
    (client: ApiClient): React.FC<{children: React.ReactNode}> =>
    ({children}) => <ApiClientProvider client={client}>{children}</ApiClientProvider>;

  it("builds path and query params for queries", async () => {
    const sdk = await import(sdkPath);
    const {calls, client} = fakeBackend();

    const {result} = renderHook(
      () => sdk.useGetGptDatasetsByIdQuery({historyId: "h1", id: "d 1"}),
      {wrapper: wrapperFor(client)}
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({columns: ["a"], rows: [[1]]});
    });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://api.test/gpt/datasets/d%201?historyId=h1");
  });

  it("runs mutations with a flattened path argument and unwraps the result", async () => {
    const sdk = await import(sdkPath);
    const {calls, client} = fakeBackend();
    const {result} = renderHook(() => sdk.useTodosMarkCompleteMutation(), {
      wrapper: wrapperFor(client),
    });

    let todo: unknown;
    await act(async () => {
      todo = await result.current[0]("t 1").unwrap();
    });

    expect(todo).toEqual({_id: "t 1", completed: true, title: "Ship it"});
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "http://api.test/todos/t%201/markComplete",
    });
  });

  it("supports lazy queries and multipart bodies", async () => {
    const sdk = await import(sdkPath);
    const {calls, client} = fakeBackend();
    const wrapper = wrapperFor(client);
    const lazy = renderHook(() => sdk.useLazyGetVersionCheckQuery(), {wrapper});
    const upload = renderHook(() => sdk.usePostFilesUploadMutation(), {wrapper});
    const form = new FormData();
    form.append("file", "hello");

    let status: unknown;
    let uploaded: unknown;
    await act(async () => {
      status = await lazy.result.current[0]({platform: "web", version: 3}).unwrap();
      uploaded = await upload.result.current[0](form).unwrap();
    });

    expect(status).toEqual({status: "ok"});
    expect(calls[0].url).toBe("http://api.test/version-check?platform=web&version=3");
    expect(uploaded).toEqual({mimeType: "text/plain", url: "gs://bucket/a.txt"});
    expect(calls[1].body).toBe(form);
  });

  it("keeps slashes in Express wildcard params while encoding each segment", async () => {
    const sdk = await import(sdkPath);

    expect(sdk.getFilesByGcsKeyRequest("users/u 1/report.pdf")).toEqual({
      method: "GET",
      url: "/files/users/u%201/report.pdf",
    });
  });

  it("exports request builders for imperative calls", async () => {
    const sdk = await import(sdkPath);

    expect(sdk.patchAuthMeRequest({name: "Ada"})).toEqual({
      body: {name: "Ada"},
      method: "PATCH",
      url: "/auth/me",
    });
    expect(sdk.getGptHistoriesRequest({limit: 5})).toEqual({
      method: "GET",
      params: {limit: 5, page: undefined, sort: undefined},
      url: "/gpt/histories/",
    });
  });

  it("type-checks under strict TypeScript", async () => {
    const proc = Bun.spawn(
      [
        "bunx",
        "tsc",
        "--noEmit",
        "--ignoreConfig",
        "--allowImportingTsExtensions",
        "--strict",
        "--skipLibCheck",
        "--jsx",
        "react-jsx",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--target",
        "es2022",
        "--lib",
        "dom,es2022",
        "--types",
        "bun",
        sdkPath,
      ],
      {cwd: resolve(import.meta.dir, "../.."), stderr: "pipe", stdout: "pipe"}
    );
    const output = await new Response(proc.stdout).text();

    expect(output).toBe("");
    expect(await proc.exited).toBe(0);
  }, 60_000);

  it("writes the generated header and imports", async () => {
    const written = await readFile(sdkPath, "utf8");

    expect(written.startsWith("// GENERATED by @terreno/syncdb")).toBe(true);
    expect(written).toContain(`from ${JSON.stringify(REACT_ENTRY)}`);
  });
});
