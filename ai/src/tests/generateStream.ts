/** What a LanguageModelV2 mock's `doGenerate` returns, as far as streaming needs it. */
interface GenerateResultLike {
  content: ReadonlyArray<
    | {text: string; type: "text"}
    | {input: string; toolCallId: string; toolName: string; type: "tool-call"}
  >;
  finishReason: string;
  usage: {inputTokens?: number; outputTokens?: number; totalTokens?: number};
}

/** Replay a `doGenerate` result as the LanguageModelV2 stream `doStream` returns. */
export const generateToStream = (
  result: GenerateResultLike
): {stream: ReadableStream<unknown>} => ({
  stream: new ReadableStream({
    start(controller) {
      controller.enqueue({type: "stream-start", warnings: []});
      result.content.forEach((part, index) => {
        if (part.type === "text") {
          const id = `text-${index}`;
          controller.enqueue({id, type: "text-start"});
          controller.enqueue({delta: part.text, id, type: "text-delta"});
          controller.enqueue({id, type: "text-end"});
          return;
        }
        controller.enqueue(part);
      });
      controller.enqueue({finishReason: result.finishReason, type: "finish", usage: result.usage});
      controller.close();
    },
  }),
});

/**
 * Give a `doGenerate`-scripted mock a `doStream` that answers through the same
 * `doGenerate`, so call counts, recorded prompts, and thrown errors stay in one place.
 */
export const withGenerateStreaming = <
  Model extends {doGenerate: (options: never) => Promise<GenerateResultLike>},
>(
  model: Model
): Model & {doStream: (options: Parameters<Model["doGenerate"]>[0]) => Promise<unknown>} => {
  const wrapped = {
    ...model,
    doStream: async (options: Parameters<Model["doGenerate"]>[0]) =>
      generateToStream(await wrapped.doGenerate(options)),
  };
  return wrapped;
};
