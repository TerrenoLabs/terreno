import type {OpenApiDocument} from "./operations";

export interface GenerateRestCliOptions {
  baseUrl?: string;
  binName: string;
  cliVersion?: string;
  spec: OpenApiDocument;
  specLiteral: string;
}

export const generateRestCliFiles = (
  options: GenerateRestCliOptions
): Array<{content: string; path: string}> => {
  const binName = options.binName;
  const specLiteral = options.specLiteral;
  const cliVersion = options.cliVersion ? `^${options.cliVersion}` : "latest";
  const defaultBase = options.baseUrl ?? options.spec.servers?.[0]?.url ?? "";
  const title = options.spec.info?.title ?? binName;

  const cliSource = `#!/usr/bin/env bun
import {runAppRestCli} from "@terreno/cli";

const SPEC = ${JSON.stringify(specLiteral)};

const code = await runAppRestCli({
  argv: process.argv.slice(2),
  binName: ${JSON.stringify(binName)},
  defaultBaseUrl: ${JSON.stringify(defaultBase)},
  specText: SPEC,
  title: ${JSON.stringify(title)},
});
process.exit(code);
`;

  const packageJson = {
    bin: {[binName]: "./src/cli.ts"},
    dependencies: {"@terreno/cli": cliVersion},
    description: `OpenAPI CLI for ${title}`,
    name: binName,
    private: true,
    type: "module",
  };

  const readme = `# ${binName}

Generated Terreno REST CLI for **${title}**.

\`\`\`bash
bun ${binName} --help
bun ${binName} list
bun ${binName} call <operationId> --param name=value
bun ${binName} request GET /path/{id} --param id=123
\`\`\`

Auth: \`--token\` or \`TERRENO_TOKEN\`. Base URL: \`--base-url\` or \`TERRENO_API_URL\`.
`;

  return [
    {content: `${cliSource}`, path: "src/cli.ts"},
    {content: `${JSON.stringify(packageJson, null, 2)}\n`, path: "package.json"},
    {content: `${readme}\n`, path: "README.md"},
    {
      content: `${JSON.stringify(options.spec, null, 2)}\n`,
      path: "openapi.json",
    },
  ];
};
