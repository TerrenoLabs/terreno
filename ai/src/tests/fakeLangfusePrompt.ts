/** The fields of a Langfuse prompt that tests stub `client.prompt.get` with. */
export interface FakeLangfusePrompt {
  config: Record<string, unknown>;
  labels: string[];
  name: string;
  prompt: string | Array<{content: string; role: string}>;
  tags: string[];
  type: "chat" | "text";
  version: number;
}
