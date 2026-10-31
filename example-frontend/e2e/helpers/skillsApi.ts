import {type APIRequestContext, request} from "@playwright/test";

import type {E2EUser} from "../fixtures/testUsers";
import {signUpOrSignInBetterAuth} from "./betterAuthSession";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:8082";

interface SkillRow {
  _id: string;
  name: string;
  scope?: "user" | "global";
}

export interface SkillsApi {
  /** Deletes every skill `scope` the signed-in user can see, so each attempt starts clean. */
  clear: (scope: "user" | "global") => Promise<void>;
  dispose: () => Promise<void>;
  /** Creates a skill through `POST /gpt/skills`. */
  seed: (skill: {
    description: string;
    instructions: string;
    name: string;
    scope?: "user" | "global";
  }) => Promise<void>;
}

/** Arranges skills through the API as `user`; specs act through the UI. */
export const skillsApiAs = async (user: E2EUser): Promise<SkillsApi> => {
  const api: APIRequestContext = await request.newContext({baseURL: API_URL});
  const headers = {
    authorization: `Bearer ${await signUpOrSignInBetterAuth(api, user)}`,
    origin: FRONTEND_ORIGIN,
  };
  return {
    clear: async (scope): Promise<void> => {
      const listed = await api.get("/gpt/skills?limit=200", {headers});
      const rows = ((await listed.json()) as {data?: SkillRow[]}).data ?? [];
      for (const row of rows.filter((skill) => (skill.scope ?? "user") === scope)) {
        await api.delete(`/gpt/skills/${row._id}`, {headers});
      }
    },
    dispose: async (): Promise<void> => {
      await api.dispose();
    },
    seed: async (skill): Promise<void> => {
      const created = await api.post("/gpt/skills", {data: skill, headers});
      if (!created.ok()) {
        throw new Error(`POST /gpt/skills failed with ${created.status()}`);
      }
    },
  };
};
