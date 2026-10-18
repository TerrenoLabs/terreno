export interface TodoSummaryEntry {
  completed?: boolean;
  title?: string;
}

/** Cap the prompt input so a long list never blows past the model's context window. */
const MAX_SUMMARY_TODOS = 25;

/**
 * Builds the user text sent to the seeded `example-summarize` production prompt.
 * Returns an empty string when nothing is worth summarizing, so callers can keep
 * the action disabled instead of tracing an empty run.
 */
export const buildTodoSummaryInput = (todos: TodoSummaryEntry[]): string => {
  const lines = todos
    .filter((todo) => {
      return Boolean(todo.title?.trim());
    })
    .slice(0, MAX_SUMMARY_TODOS)
    .map((todo) => {
      return `- [${todo.completed ? "done" : "open"}] ${todo.title?.trim()}`;
    });
  if (lines.length === 0) {
    return "";
  }
  return `My todo list:\n${lines.join("\n")}`;
};
