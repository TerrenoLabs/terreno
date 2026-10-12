import {describe, expect, test} from "bun:test";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {handleToolCall} from "../tools.js";

// The virtual component lives beside this test so "@terreno/ui" and "react" resolve through the
// workspace node_modules exactly as they would in an app. It is never written to disk.
const virtualFile = fileURLToPath(new URL("./__generatedFormFields.tsx", import.meta.url));

const COMPILER_OPTIONS: ts.CompilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

// Wrap the tool's snippet (imports, state declarations, field JSX) in a component.
const toComponentSource = (generated: string): string => {
  const imports = generated.match(/^import .*$/gm) ?? [];
  const stateDeclarations = generated
    .split("// State declarations (add to your component):")[1]
    .split("// Form fields")[0];
  const jsx = generated.slice(
    generated.indexOf("<Box gap={3}>"),
    generated.lastIndexOf("</Box>") + "</Box>".length
  );
  return `${imports.join("\n")}
import type {ReactElement} from "react";

export const GeneratedForm = (): ReactElement => {
${stateDeclarations}
  return (
    ${jsx}
  );
};
`;
};

// Type-check the source against the real @terreno/ui declarations; returns readable errors.
const typeCheck = (source: string): string[] => {
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const {fileExists, getSourceFile, readFile} = host;
  host.fileExists = (fileName): boolean => fileName === virtualFile || fileExists(fileName);
  host.readFile = (fileName): string | undefined =>
    fileName === virtualFile ? source : readFile(fileName);
  host.getSourceFile = (
    fileName,
    languageVersion,
    onError,
    shouldCreate
  ): ts.SourceFile | undefined =>
    fileName === virtualFile
      ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TSX)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);

  const program = ts.createProgram({host, options: COMPILER_OPTIONS, rootNames: [virtualFile]});
  const sourceFile = program.getSourceFile(virtualFile);
  return ts
    .getPreEmitDiagnostics(program, sourceFile)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
};

describe("terreno_generate_form_fields output compiles against @terreno/ui", () => {
  test("every supported field type type-checks", async () => {
    const result = await handleToolCall("terreno_generate_form_fields", {
      fields: [
        {name: "name", required: true, type: "text"},
        {name: "email", required: true, type: "email"},
        {name: "password", required: true, type: "password"},
        {name: "age", required: true, type: "number"},
        {name: "bio", type: "textarea"},
        {
          name: "priority",
          options: [
            {label: "Low", value: "low"},
            {label: "High", value: "high"},
          ],
          required: true,
          type: "select",
        },
        {name: "active", type: "boolean"},
        {name: "dueDate", required: true, type: "date"},
        {name: "startsAt", type: "datetime"},
      ],
    });
    const source = toComponentSource(result.content[0].text);

    expect(typeCheck(source)).toEqual([]);
  }, 120_000);

  test("the checker rejects props @terreno/ui does not define", () => {
    // Guards the harness itself: the old output must fail, or the test above proves nothing.
    const source = `import {Box, SelectField} from "@terreno/ui";
import {useState} from "react";
import type {ReactElement} from "react";

export const GeneratedForm = (): ReactElement => {
  const [priority, setPriority] = useState("");
  return (
    <Box gap={3}>
      <SelectField label="Priority" value={priority} onChangeValue={setPriority} options={[]} />
    </Box>
  );
};
`;

    const errors = typeCheck(source).join("\n");

    expect(errors).toContain("label");
  }, 120_000);
});
