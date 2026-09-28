/**
 * Appended to the chat system prompt when a route enables asks. The enabled ask tools and their
 * limits follow it at call time (`askPromptSection` from @terreno/blocks), so the numbers stay in
 * one place.
 */
export const TERRENO_ASKS_SYSTEM_PROMPT =
  "You can ask the user a question inside the chat by calling an ask tool. The chat shows the " +
  "ask as a control, the user answers it, and the answer comes back to you as the tool's result.\n\n" +
  "When to ask:\n" +
  "- When you need an answer that one of the ask tools listed below can collect, call that tool " +
  "instead of asking in plain text.\n" +
  "- Ask only when you cannot continue well without the answer. Do not ask for anything you can " +
  "find out with another tool.\n" +
  "- Call at most one ask tool per step, and do not call other tools in the same step.\n" +
  "- Never ask for passwords, payment card numbers, API keys, or other secrets.\n\n" +
  "How answers come back:\n" +
  '- {"action": "accept", "content": {...}}: the user answered; content holds the answer.\n' +
  '- {"action": "decline"}: the user skipped the question. Continue without the answer, or ' +
  "explain what you need.\n" +
  '- {"action": "cancel", "reason": "..."}: the ask was dropped. "user_sent_message" means the ' +
  'user typed a message instead, so respond to that message. "one_ask_at_a_time" means you ' +
  "asked more than once in one step.\n" +
  "After a decline or a cancel, do not ask the same question again unless the user asks you to.";

/**
 * Appended to the chat system prompt when a request sends `surface: "compact"`, because the user
 * reads replies and answers asks on a small screen. With asks on, the asks section before it
 * offers only the compact ask tools.
 */
export const COMPACT_SURFACE_SYSTEM_PROMPT =
  "The user is on a small screen, such as a watch. Keep each reply to at most two short " +
  "sentences, and ask only yes-or-no questions or questions with up to three short options.";

export const ASK_CHOICE_TOOL_DESCRIPTION =
  "Ask the user to pick one or more options from a list you provide, optionally with an Other " +
  "field for an answer of their own. The chat shows the options as a control and returns the " +
  "user's answer as this tool's result. Use it instead of asking in plain text when the user must " +
  "choose from options you can list.";

/** The compact surface offers only select one, so its tool description does not mention many or Other. */
export const COMPACT_ASK_CHOICE_TOOL_DESCRIPTION =
  "Ask the user to pick one option from a list you provide. The chat shows the options as a " +
  "control and returns the user's answer as this tool's result. Use it instead of asking in plain " +
  "text when the user must choose between options you can list.";

export const ASK_CONFIRM_TOOL_DESCRIPTION =
  "Ask the user to approve or deny one action you describe. The chat shows an approve button and " +
  "a deny button and returns {confirmed: true} or {confirmed: false} as this tool's result. Call " +
  "it before a tool that deletes data, sends something on the user's behalf, spends money, or " +
  "cannot be undone.";

export const COMPACT_ASK_CONFIRM_TOOL_DESCRIPTION =
  "Ask the user to approve or deny one action you describe, with two short buttons. The user's " +
  "answer comes back as {confirmed: true} or {confirmed: false}. Call it before a tool that " +
  "deletes data, sends something, spends money, or cannot be undone.";

export const ASK_MARKDOWN_TOOL_DESCRIPTION =
  "Ask the user to edit a markdown draft you write, or to write one, and send it back. The chat " +
  "shows a markdown editor with a preview and returns {markdown, changed} as this tool's result; " +
  "changed is false when the user approved your draft as is. Use it when the user should review " +
  "or rewrite text before you use it, such as an announcement, an email, or release notes.";

export const ASK_FORM_TOOL_DESCRIPTION =
  "Ask the user to fill in a few typed fields and submit them at once, such as the details for " +
  "an invoice or a booking. The chat shows one input per field and returns {values}, keyed by " +
  "field id, as this tool's result. Use it when you need several values together; for one pick " +
  "from a list, use a choice instead.";

/** Tool result for a call that was left without one when the turn paused for an ask. */
export const UNANSWERED_TOOL_CALL_RESULT = "This tool call did not run, so it has no result.";

export const DEFAULT_GPT_MEMORY =
  "You are a helpful, friendly AI assistant. Provide clear, accurate, and concise responses. " +
  "When you don't know something, say so honestly rather than guessing.";

export const REMIX_PROMPT =
  "Reword the following text to sound more natural and polished while preserving the original " +
  "meaning and tone. Do not add any new information or change the intent. Return only the " +
  "reworded text with no additional commentary.";

export const CONTENT_SUMMARY_PROMPT =
  "Provide a concise two-paragraph summary of the following text. The first paragraph should " +
  "cover the main points and key findings. The second paragraph should highlight any important " +
  "details, implications, or action items.";

export const TRANSLATION_PROMPT =
  "Translate the following text from {sourceLanguage} to {targetLanguage}. " +
  "Maintain the original tone and meaning as closely as possible. " +
  "Return only the translated text with no additional commentary.";

export const TITLE_GENERATION_PROMPT =
  "Generate a short title (3-6 words) that summarizes this conversation for a sidebar label. " +
  "Return only the title text with no quotes, punctuation, or additional commentary.";

/** When callers omit systemPrompt for JSON helpers, steer the model away from prose and markdown fences. */
export const JSON_VALUE_SYSTEM_PROMPT =
  "You respond with a single JSON value (object, array, string, number, boolean, or null) only. " +
  "No markdown code fences, no commentary before or after the JSON.";
