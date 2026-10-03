/**
 * Path-filter parity between GitHub Actions workflows and their CircleCI twins.
 *
 * During the CircleCI dual-run (docs/how-to/circleci.md) every ported GHA
 * workflow has a CircleCI job gated by a pipeline parameter set by the
 * path-filtering orb. A path watched by the GHA workflow but absent from the
 * mapping silently skips the twin, so CircleCI reports success without ever
 * running the job.
 */
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

// GHA workflow file (without extension) -> CircleCI pipeline parameter.
export const WORKFLOW_PARAMETERS: Record<string, string> = {
  "admin-spa-ci": "run-admin-spa",
  "admin-spa-integration": "run-admin-spa-integration",
  "ai-ci": "run-ai",
  "api-ci": "run-api",
  "blocks-ci": "run-blocks",
  "comms-ci": "run-comms",
  "create-terreno-app-ci": "run-create-terreno-app",
  "e2e-ci": "run-e2e",
  "example-backend-ci": "run-example-backend",
  "example-backend-docker": "run-example-backend-docker",
  "example-backend-script-runner": "run-example-backend-script",
  "example-frontend-ci": "run-example-frontend",
  "jobs-ci": "run-jobs",
  "mcp-server-ci": "run-mcp-server",
  "new-file-coverage": "run-new-file-coverage",
  "repo-policies": "run-repo-policies",
  "rtk-ci": "run-rtk",
  "rulesync-check": "run-rulesync",
  "syncdb-ci": "run-syncdb",
  "ui-ci": "run-ui",
  "ui-demo-ci": "run-ui-demo",
};

export interface Mapping {
  parameter: string;
  regex: string;
}

export interface Gap {
  parameter: string;
  path: string;
  workflow: string;
}

interface SetupConfig {
  setup?: boolean;
  workflows?: {
    setup?: {
      jobs?: {"path-filtering/filter"?: {mapping?: string}}[];
    };
  };
}

interface WorkflowTrigger {
  paths?: string[];
}

interface WorkflowConfig {
  on?: Record<string, WorkflowTrigger | undefined>;
  true?: Record<string, WorkflowTrigger | undefined>;
}

const parseYaml = <T>(path: string): T => Bun.YAML.parse(readFileSync(path, "utf8")) as T;

const SETUP_CONFIG_FILES = ["config.yml", "config.setup.yml"] as const;

const isSetupConfig = (config: SetupConfig): boolean => {
  return config.setup === true;
};

const readSetupConfig = ({repoRoot}: {repoRoot: string}): SetupConfig => {
  const candidates: {path: string; config: SetupConfig}[] = [];
  for (const fileName of SETUP_CONFIG_FILES) {
    const path = join(repoRoot, ".circleci", fileName);
    if (!existsSync(path)) {
      continue;
    }
    candidates.push({config: parseYaml<SetupConfig>(path), path});
  }
  if (candidates.length === 0) {
    throw new Error("no CircleCI setup config found (.circleci/config.yml or config.setup.yml)");
  }
  const enabled = candidates.find((candidate) => isSetupConfig(candidate.config));
  return enabled?.config ?? candidates[0].config;
};

export const readMappings = ({repoRoot}: {repoRoot: string}): Mapping[] => {
  const config = readSetupConfig({repoRoot});
  const filterJob = config?.workflows?.setup?.jobs?.[0]?.["path-filtering/filter"];
  const raw = filterJob?.mapping ?? "";
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([regex, parameter]) => ({parameter, regex}) as Mapping);
};

export const readWorkflowPaths = ({
  repoRoot,
  workflow,
}: {
  repoRoot: string;
  workflow: string;
}): string[] => {
  const doc = parseYaml<WorkflowConfig>(join(repoRoot, ".github", "workflows", `${workflow}.yml`));
  // Some YAML parsers read the `on:` key as the boolean `true`.
  const triggers = doc?.on ?? doc?.true ?? {};
  const paths: string[] = [];
  for (const trigger of ["push", "pull_request"]) {
    const value = triggers?.[trigger];
    if (Array.isArray(value?.paths)) {
      paths.push(...value.paths);
    }
  }
  return [...new Set(paths)];
};

/** Representative changed-file paths for a GHA glob; the orb matches one file. */
export const samplesForGlob = (glob: string): string[] => {
  if (glob.endsWith("/**")) {
    const base = glob.slice(0, -3);
    return [`${base}/sample.ts`, `${base}/nested/sample.ts`];
  }
  if (glob.startsWith("**/")) {
    const tail = glob.slice(3);
    return [tail, `nested/${tail}`];
  }
  return [glob];
};

export const isCovered = ({
  mappings,
  parameter,
  samples,
}: {
  mappings: Mapping[];
  parameter: string;
  samples: string[];
}): boolean => {
  const candidates = mappings.filter((mapping) => mapping.parameter === parameter);
  if (samples.length === 0) {
    return false;
  }
  // path-filtering anchors every mapping regex with ^…$. A GHA glob is covered
  // only when every representative sample would set the twin's parameter.
  return samples.every((sample) =>
    candidates.some((mapping) => new RegExp(`^(?:${mapping.regex})$`).test(sample))
  );
};

export const collectParityGaps = ({
  repoRoot,
  workflowParameters = WORKFLOW_PARAMETERS,
}: {
  repoRoot: string;
  workflowParameters?: Record<string, string>;
}): Gap[] => {
  const mappings = readMappings({repoRoot});
  if (mappings.length === 0) {
    throw new Error(
      "no path-filtering mapping found in .circleci/config.yml or .circleci/config.setup.yml"
    );
  }

  const gaps: Gap[] = [];
  for (const [workflow, parameter] of Object.entries(workflowParameters)) {
    for (const path of readWorkflowPaths({repoRoot, workflow})) {
      // GHA workflows watch their own file; CircleCI watches .circleci instead.
      if (path.startsWith(".github/")) {
        continue;
      }
      if (!isCovered({mappings, parameter, samples: samplesForGlob(path)})) {
        gaps.push({parameter, path, workflow});
      }
    }
  }
  return gaps;
};
