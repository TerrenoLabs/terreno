import type {AdminContribution, TerrenoPlugin} from "@terreno/api";
import type express from "express";

import {GptSkill} from "./models/gptSkill";
import {addAiRequestsExplorerRoutes} from "./routes/aiRequestsExplorer";

export interface AIAdminAppOptions {
  openApiOptions?: Record<string, unknown>;
}

/**
 * Registers the AI request explorer API and contributes its admin screen plus the global skills
 * model. Admins manage only global skills: users' personal skills never appear in the panel, and
 * `scope`, `userId`, and `files` stay out of the form so an admin create saves a global skill.
 */
export class AIAdminApp implements TerrenoPlugin {
  private options: AIAdminAppOptions;

  constructor(options: AIAdminAppOptions = {}) {
    this.options = options;
  }

  adminContribution(): AdminContribution {
    return {
      customScreens: [{displayName: "AI Requests", icon: "robot", name: "ai-requests"}],
      models: [
        {
          admin: {
            adminFilter: () => ({scope: "global"}),
            displayName: "Skills",
            group: "AI",
            hiddenFields: ["scope", "userId", "files"],
            listFields: ["name", "description", "scope", "enabled", "updated"],
          },
          model: GptSkill as never,
          routePath: "/gpt/skills",
        },
      ],
    };
  }

  register(app: express.Application): void {
    addAiRequestsExplorerRoutes(app, {openApiOptions: this.options.openApiOptions});
  }
}
