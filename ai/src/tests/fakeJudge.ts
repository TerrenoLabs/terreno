/**
 * A stub for `AIService.generateJsonObject` that answers every call with `answer()`, whatever
 * schema the caller asks for. The real method is generic over the parsed object's type.
 */
export const judgeAnswering =
  (answer: () => Record<string, unknown>) =>
  async <OBJECT>(): Promise<OBJECT> =>
    answer() as OBJECT;
