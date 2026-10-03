import {APIError} from "@terreno/api";
import {DateTime} from "luxon";
import type mongoose from "mongoose";

import type {ObsPromptVariable} from "../../types/observability";
import {compileTemplate} from "../compileTemplate";
import type {ModelPrice, PromptRegistry, PromptVersionRef} from "../types";
import {registerObsExperiment} from "./models/obsExperiment";
import {registerObsPrompt} from "./models/obsPrompt";
import {registerObsPromptLabel} from "./models/obsPromptLabel";
import {registerObsPromptVersion} from "./models/obsPromptVersion";
import {registerObsTrace} from "./models/obsTrace";

const PROMPT_RELATIONSHIP_LIMIT = 20;

export interface PromptRelatedExperimentSummary {
  created: string;
  id: string;
  name: string;
  promptName: string;
  status: "completed" | "failed" | "pending" | "running";
  versions: number[];
}

export interface PromptRelatedTraceSummary {
  id: string;
  name: string;
  promptName: string;
  promptVersion: number;
  sensitive: boolean;
  startedAt: string;
  status: "error" | "ok";
}

export interface PromptRelationships {
  experiments: {
    items: PromptRelatedExperimentSummary[];
    limit: number;
    total: number;
  };
  traces: {
    items: PromptRelatedTraceSummary[];
    limit: number;
    total: number;
  };
}

export interface PromptVersionFields {
  config?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputFieldNotes?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
  sensitive?: boolean;
  system?: string;
  template?: string;
  type: "chat" | "text";
  variables?: ObsPromptVariable[];
}

export interface CreatePromptInput extends PromptVersionFields {
  description?: string;
  folder: string;
  name: string;
  tags?: string[];
}

export interface PromptListItem {
  description?: string;
  folder: string;
  latestVersion: number;
  name: string;
  production: number | "—";
  type: "chat" | "text";
  usage7d?: {calls: number; costUsd?: number};
}

export interface MoveLabelResult {
  label: string;
  outgoingVersion?: number;
  version: number;
}

export interface CompiledMessage {
  content: string;
  role: "system" | "user";
}

export interface PlaygroundRunResult {
  compiledMessages: CompiledMessage[];
  costUsd?: number;
  latencyMs: number;
  output: string;
  tokens: {inputTokens?: number; outputTokens?: number; totalTokens?: number};
}

export interface PlaygroundGenerator {
  generate: (args: {
    prompt: string;
    systemPrompt?: string;
    userId?: mongoose.Types.ObjectId;
  }) => Promise<{
    inputTokens?: number;
    latencyMs: number;
    output: string;
    outputTokens?: number;
  }>;
}

const versionBody = (system?: string, template?: string): string => {
  if (system && system.length > 0) {
    return system;
  }
  return template ?? "";
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const computeCostUsd = (params: {
  inputTokens?: number;
  modelId: string;
  outputTokens?: number;
  priceMap?: Record<string, ModelPrice>;
}): number | undefined => {
  if (!params.priceMap) {
    return undefined;
  }
  const price = params.priceMap[params.modelId];
  if (!price || params.inputTokens === undefined || params.outputTokens === undefined) {
    return undefined;
  }
  return (
    (price.inputPerMTok * params.inputTokens + price.outputPerMTok * params.outputTokens) /
    1_000_000
  );
};

export class LocalPromptStore implements PromptRegistry {
  async create(input: CreatePromptInput): Promise<{name: string; version: number}> {
    if (!input.folder || !input.name) {
      throw new APIError({status: 400, title: "folder and name are required"});
    }
    const ObsPrompt = registerObsPrompt();
    const existing = await ObsPrompt.findOneOrNone({name: input.name});
    if (existing) {
      throw new APIError({status: 409, title: `Prompt "${input.name}" already exists`});
    }
    try {
      const prompt = await ObsPrompt.create({
        ...(input.description !== undefined ? {description: input.description} : {}),
        folder: input.folder,
        name: input.name,
        tags: input.tags ?? [],
      });
      const version = await this.insertVersion(prompt._id, 1, input);
      await this.upsertLabel(prompt._id, "latest", version._id);
      return {name: prompt.name, version: 1};
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        throw new APIError({status: 409, title: `Prompt "${input.name}" already exists`});
      }
      throw error;
    }
  }

  async createVersion(
    name: string,
    fields: PromptVersionFields
  ): Promise<{name: string; version: number}> {
    const prompt = await this.requirePrompt(name);
    const ObsPromptVersion = registerObsPromptVersion();
    const latestDocs = await ObsPromptVersion.find({promptId: prompt._id})
      .sort({version: -1})
      .limit(1);
    const nextVersion = (latestDocs[0]?.version ?? 0) + 1;
    const created = await this.insertVersion(prompt._id, nextVersion, fields);
    await this.upsertLabel(prompt._id, "latest", created._id);
    return {name: prompt.name, version: nextVersion};
  }

  async moveLabel(
    name: string,
    params: {label: string; version: number}
  ): Promise<MoveLabelResult> {
    if (params.label !== "production" && params.label !== "staging") {
      throw new APIError({status: 400, title: "label must be production or staging"});
    }
    const prompt = await this.requirePrompt(name);
    const ObsPromptVersion = registerObsPromptVersion();
    const versionDoc = await ObsPromptVersion.findOneOrNone({
      promptId: prompt._id,
      version: params.version,
    });
    if (!versionDoc) {
      throw new APIError({
        status: 404,
        title: `Unknown version ${params.version} for prompt "${name}"`,
      });
    }
    const outgoingVersion = await this.upsertLabel(prompt._id, params.label, versionDoc._id);
    return {label: params.label, outgoingVersion, version: params.version};
  }

  async get(args: {label?: string; name: string}): Promise<PromptVersionRef | undefined> {
    const prompt = await registerObsPrompt().findOneOrNone({name: args.name});
    if (!prompt) {
      return undefined;
    }
    const label = args.label ?? "production";
    const labelDoc = await registerObsPromptLabel().findOneOrNone({
      label,
      promptId: prompt._id,
    });
    if (!labelDoc) {
      return undefined;
    }
    const version = await registerObsPromptVersion().findOneOrNone({_id: labelDoc.versionId});
    if (!version) {
      return undefined;
    }
    return {
      body: versionBody(version.system, version.template),
      label,
      name: prompt.name,
      sensitive: version.sensitive,
      version: version.version,
    };
  }

  async getDetail(
    name: string,
    options?: {promptVersion?: number}
  ): Promise<{
    description?: string;
    folder: string;
    labels: Array<{label: string; version: number}>;
    name: string;
    relationships: PromptRelationships;
    tags: string[];
    versions: Array<{
      config?: Record<string, unknown>;
      created: string;
      sensitive: boolean;
      system?: string;
      template?: string;
      type: "chat" | "text";
      variables: ObsPromptVariable[];
      version: number;
    }>;
  }> {
    const prompt = await this.requirePrompt(name);
    const versions = await registerObsPromptVersion().find({promptId: prompt._id}).sort({
      version: 1,
    });
    const labels = await registerObsPromptLabel().find({promptId: prompt._id});
    const versionById = new Map(versions.map((row) => [String(row._id), row.version]));
    return {
      ...(prompt.description !== undefined ? {description: prompt.description} : {}),
      folder: prompt.folder,
      labels: labels.map((row) => {
        return {label: row.label, version: versionById.get(String(row.versionId)) ?? 0};
      }),
      name: prompt.name,
      relationships: await this.loadRelationships(prompt.name, options?.promptVersion),
      tags: prompt.tags,
      versions: versions.map((row) => {
        return {
          config: row.config,
          created: DateTime.fromJSDate(row.created).toUTC().toISO() ?? "",
          sensitive: row.sensitive,
          system: row.system,
          template: row.template,
          type: row.type,
          variables: row.variables,
          version: row.version,
        };
      }),
    };
  }

  async list(params: {
    folder?: string;
    includeUsage7d?: boolean;
    search?: string;
  }): Promise<PromptListItem[]> {
    const filter: Record<string, unknown> = {};
    if (params.folder) {
      filter.folder = params.folder;
    }
    if (params.search) {
      filter.name = {$options: "i", $regex: escapeRegex(params.search)};
    }
    const prompts = await registerObsPrompt().find(filter).sort({folder: 1, name: 1});
    const usageByName = params.includeUsage7d
      ? await this.usageLast7d(prompts.map((row) => row.name))
      : undefined;

    const items: PromptListItem[] = [];
    for (const prompt of prompts) {
      const versions = await registerObsPromptVersion()
        .find({promptId: prompt._id})
        .sort({version: -1})
        .limit(1);
      const productionLabel = await registerObsPromptLabel().findOneOrNone({
        label: "production",
        promptId: prompt._id,
      });
      let production: number | "—" = "—";
      if (productionLabel) {
        const productionVersion = await registerObsPromptVersion().findOneOrNone({
          _id: productionLabel.versionId,
        });
        if (productionVersion) {
          production = productionVersion.version;
        }
      }
      const latest = versions[0];
      items.push({
        ...(prompt.description !== undefined ? {description: prompt.description} : {}),
        folder: prompt.folder,
        latestVersion: latest?.version ?? 0,
        name: prompt.name,
        production,
        type: latest?.type ?? "text",
        ...(usageByName ? {usage7d: usageByName.get(prompt.name) ?? {calls: 0}} : {}),
      });
    }
    return items;
  }

  compile(params: {
    system?: string;
    template?: string;
    userPrompt?: string;
    variables?: Record<string, string>;
  }): CompiledMessage[] {
    const variables = params.variables ?? {};
    const messages: CompiledMessage[] = [];
    const system = compileTemplate(params.system ?? "", variables);
    if (system.length > 0) {
      messages.push({content: system, role: "system"});
    }
    const template = compileTemplate(params.template ?? "", variables);
    const userContent = template.length > 0 ? template : (params.userPrompt ?? "");
    if (userContent.length > 0) {
      messages.push({content: userContent, role: "user"});
    }
    return messages;
  }

  async runPlayground(params: {
    generator: PlaygroundGenerator;
    modelId: string;
    name: string;
    priceMap?: Record<string, ModelPrice>;
    userId?: mongoose.Types.ObjectId;
    userPrompt?: string;
    variables?: Record<string, string>;
    version?: number;
  }): Promise<PlaygroundRunResult> {
    const prompt = await this.requirePrompt(params.name);
    const versionDoc = await this.resolvePlaygroundVersion(prompt._id, params.version);
    const compiledMessages = this.compile({
      system: versionDoc.system,
      template: versionDoc.template,
      userPrompt: params.userPrompt,
      variables: params.variables,
    });
    const systemMessage = compiledMessages.find((message) => {
      return message.role === "system";
    });
    const userMessage = compiledMessages.find((message) => {
      return message.role === "user";
    });
    const generated = await params.generator.generate({
      prompt: userMessage?.content ?? "",
      systemPrompt: systemMessage?.content,
      userId: params.userId,
    });
    const tokens = {
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      totalTokens:
        generated.inputTokens === undefined && generated.outputTokens === undefined
          ? undefined
          : (generated.inputTokens ?? 0) + (generated.outputTokens ?? 0),
    };
    const costUsd = computeCostUsd({
      inputTokens: generated.inputTokens,
      modelId: params.modelId,
      outputTokens: generated.outputTokens,
      priceMap: params.priceMap,
    });
    return {
      compiledMessages,
      ...(costUsd === undefined ? {} : {costUsd}),
      latencyMs: generated.latencyMs,
      output: generated.output,
      tokens,
    };
  }

  private async resolvePlaygroundVersion(
    promptId: mongoose.Types.ObjectId,
    version?: number
  ): Promise<{system?: string; template?: string; version: number}> {
    const ObsPromptVersion = registerObsPromptVersion();
    if (version !== undefined) {
      const match = await ObsPromptVersion.findOneOrNone({promptId, version});
      if (!match) {
        throw new APIError({status: 404, title: `Unknown version ${version}`});
      }
      return match;
    }
    const latestLabel = await registerObsPromptLabel().findOneOrNone({
      label: "latest",
      promptId,
    });
    if (latestLabel) {
      const labelled = await ObsPromptVersion.findOneOrNone({_id: latestLabel.versionId});
      if (labelled) {
        return labelled;
      }
    }
    const latestDocs = await ObsPromptVersion.find({promptId}).sort({version: -1}).limit(1);
    if (!latestDocs[0]) {
      throw new APIError({status: 404, title: "Prompt has no versions"});
    }
    return latestDocs[0];
  }

  private async usageLast7d(
    names: string[]
  ): Promise<Map<string, {calls: number; costUsd?: number}>> {
    const result = new Map<string, {calls: number; costUsd?: number}>();
    for (const name of names) {
      result.set(name, {calls: 0});
    }
    if (names.length === 0) {
      return result;
    }
    const since = DateTime.utc().minus({days: 7}).toJSDate();
    const traces = await registerObsTrace().find({
      created: {$gte: since},
      "prompts.name": {$in: names},
    });
    for (const trace of traces) {
      const seen = new Set<string>();
      for (const ref of trace.prompts) {
        if (!names.includes(ref.name) || seen.has(ref.name)) {
          continue;
        }
        seen.add(ref.name);
        const current = result.get(ref.name) ?? {calls: 0};
        current.calls += 1;
        if (trace.usage?.costUsd !== undefined) {
          current.costUsd = (current.costUsd ?? 0) + trace.usage.costUsd;
        }
        result.set(ref.name, current);
      }
    }
    return result;
  }

  private async insertVersion(
    promptId: mongoose.Types.ObjectId,
    version: number,
    fields: PromptVersionFields
  ): Promise<{_id: mongoose.Types.ObjectId}> {
    return registerObsPromptVersion().create({
      config: fields.config,
      inputSchema: fields.inputSchema,
      outputFieldNotes: fields.outputFieldNotes,
      outputSchema: fields.outputSchema,
      promptId,
      sensitive: fields.sensitive ?? false,
      system: fields.system,
      template: fields.template,
      type: fields.type,
      variables: fields.variables ?? [],
      version,
    });
  }

  private async upsertLabel(
    promptId: mongoose.Types.ObjectId,
    label: string,
    versionId: mongoose.Types.ObjectId
  ): Promise<number | undefined> {
    const ObsPromptLabel = registerObsPromptLabel();
    const existing = await ObsPromptLabel.findOneOrNone({label, promptId});
    if (!existing) {
      await ObsPromptLabel.create({label, promptId, versionId});
      return undefined;
    }
    const previous = await registerObsPromptVersion().findOneOrNone({_id: existing.versionId});
    existing.versionId = versionId;
    await existing.save();
    return previous?.version;
  }

  async getVersionByLabel(
    name: string,
    label = "production"
  ): Promise<
    | {
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        system?: string;
        template?: string;
        type: "chat" | "text";
        variables: ObsPromptVariable[];
        version: number;
      }
    | undefined
  > {
    const prompt = await registerObsPrompt().findOneOrNone({name});
    if (!prompt) {
      return undefined;
    }
    const labelDoc = await registerObsPromptLabel().findOneOrNone({
      label,
      promptId: prompt._id,
    });
    if (!labelDoc) {
      return undefined;
    }
    const version = await registerObsPromptVersion().findOneOrNone({_id: labelDoc.versionId});
    if (!version) {
      return undefined;
    }
    return {
      inputSchema: version.inputSchema,
      outputSchema: version.outputSchema,
      system: version.system,
      template: version.template,
      type: version.type,
      variables: version.variables,
      version: version.version,
    };
  }

  async getVersionByNumber(
    name: string,
    versionNumber: number
  ): Promise<
    | {
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        system?: string;
        template?: string;
        type: "chat" | "text";
        variables: ObsPromptVariable[];
        version: number;
      }
    | undefined
  > {
    const prompt = await registerObsPrompt().findOneOrNone({name});
    if (!prompt) {
      return undefined;
    }
    const version = await registerObsPromptVersion().findOneOrNone({
      promptId: prompt._id,
      version: versionNumber,
    });
    if (!version) {
      return undefined;
    }
    return {
      inputSchema: version.inputSchema,
      outputSchema: version.outputSchema,
      system: version.system,
      template: version.template,
      type: version.type,
      variables: version.variables,
      version: version.version,
    };
  }

  private async loadRelationships(
    promptName: string,
    promptVersion?: number
  ): Promise<PromptRelationships> {
    const traceFilter: Record<string, unknown> =
      promptVersion === undefined
        ? {"prompts.name": promptName}
        : {prompts: {$elemMatch: {name: promptName, version: promptVersion}}};
    const ObsTrace = registerObsTrace();
    const totalTraces = await ObsTrace.countDocuments(traceFilter);
    const traceRows = await ObsTrace.find(traceFilter)
      .sort({created: -1})
      .limit(PROMPT_RELATIONSHIP_LIMIT);
    const traceItems: PromptRelatedTraceSummary[] = [];
    for (const row of traceRows) {
      const ref = row.prompts.find((promptRef) => {
        return promptRef.name === promptName;
      });
      if (!ref) {
        continue;
      }
      traceItems.push({
        id: String(row._id),
        name: row.name,
        promptName: ref.name,
        promptVersion: ref.version,
        sensitive: row.sensitive,
        startedAt: DateTime.fromJSDate(row.startedAt).toUTC().toISO() ?? "",
        status: row.status,
      });
    }

    const experimentFilter = {promptName};
    const ObsExperiment = registerObsExperiment();
    const totalExperiments = await ObsExperiment.countDocuments(experimentFilter);
    const experimentRows = await ObsExperiment.find(experimentFilter)
      .sort({created: -1})
      .limit(PROMPT_RELATIONSHIP_LIMIT);

    return {
      experiments: {
        items: experimentRows.map((row) => {
          return {
            created: DateTime.fromJSDate(row.created).toUTC().toISO() ?? "",
            id: String(row._id),
            name: row.name,
            promptName: row.promptName,
            status: row.status,
            versions: row.versions,
          };
        }),
        limit: PROMPT_RELATIONSHIP_LIMIT,
        total: totalExperiments,
      },
      traces: {
        items: traceItems,
        limit: PROMPT_RELATIONSHIP_LIMIT,
        total: totalTraces,
      },
    };
  }

  private async requirePrompt(name: string): Promise<{
    _id: mongoose.Types.ObjectId;
    description?: string;
    folder: string;
    name: string;
    tags: string[];
  }> {
    const prompt = await registerObsPrompt().findOneOrNone({name});
    if (!prompt) {
      throw new APIError({status: 404, title: `Unknown prompt "${name}"`});
    }
    return prompt;
  }

  private isDuplicateKey(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as {code?: number}).code === 11000
    );
  }
}
