import type {Ask, AskResponse, SimpleCard} from "@terreno/blocks";

/** Where an ask stands in the conversation. */
export type ChatAskStatus = "pending" | "answered" | "cancelled";

export interface ChatAskState {
  /** The answer the ask received. Set once the ask is answered or cancelled. */
  response?: AskResponse;
  /** The simple card the server derived when the model asked. Derived on the client when absent. */
  simple?: SimpleCard;
  status: ChatAskStatus;
  /** The model's tool call id. Answers are matched to the ask by this id. */
  toolCallId: string;
}

/** An ask as the chat shows it: the model's ask (`kind` and `input`) and where it stands. */
export type ChatAsk = Ask & ChatAskState;

/** What the host receives when the user answers an ask. */
export interface AskSubmission {
  response: AskResponse;
  toolCallId: string;
}

export type AskSubmitHandler = (submission: AskSubmission) => void | Promise<void>;
