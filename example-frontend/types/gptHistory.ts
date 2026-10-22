/**
 * GptHistory as the AI screen reads it. The generated `GetGptHistoriesByIdRes` cannot express
 * the `id` virtual, the `prompts` the server always sends, or tool-call args and the ask's input
 * and card as objects, so this type adds them on top of the generated one.
 */
import type {GetGptHistoriesByIdRes, GetGptHistoriesRes} from "@/store/apiSdk";

type GeneratedPendingAsk = NonNullable<GetGptHistoriesByIdRes["pendingAsk"]>;
type GeneratedPrompt = NonNullable<GetGptHistoriesByIdRes["prompts"]>[number];

/** The ask a conversation is waiting on. Only the chat turn writes it, so clients never send it. */
interface GptHistoryPendingAsk extends Omit<GeneratedPendingAsk, "input" | "simple"> {
  input: Record<string, unknown>;
  simple: Record<string, unknown>;
}

/** A stored transcript row. Tool-call `args` are always a JSON object. */
interface GptHistoryPrompt extends Omit<GeneratedPrompt, "args"> {
  args?: Record<string, unknown>;
}

export interface GptHistory extends Omit<GetGptHistoriesByIdRes, "pendingAsk" | "prompts"> {
  id: string;
  pendingAsk?: GptHistoryPendingAsk;
  /** A prompt with `status: "streaming"` is still being written; resume via /gpt/histories/:id/stream. */
  prompts: GptHistoryPrompt[];
}

export interface GptHistoriesListResponse extends Omit<GetGptHistoriesRes, "data"> {
  data?: GptHistory[];
}
