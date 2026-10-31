import {blocksPromptSection} from "@terreno/blocks";

/**
 * Whole-reply document instructions, with no host callbacks registered.
 * `uiBlocksSystemPrompt` rebuilds this when the host lists callback names.
 */
export const TERRENO_UI_BLOCKS_SYSTEM_PROMPT = blocksPromptSection();

/** Tells the model to return only a corrected document. The failed document and its errors are the user prompt. */
export const UI_BLOCKS_REPAIR_SYSTEM_PROMPT =
  "The document you wrote failed validation. Reply with only the corrected document. Do not explain the changes.";

/**
 * The blocks prompt for this host's callbacks, html and image settings, and rich-block opt-out.
 * Runtime values are injected here because they are host configuration, not user data.
 */
export const uiBlocksSystemPrompt = ({
  allowHtml = false,
  checklistActions = [],
  hostActions,
  imageHosts = [],
  richBlocks = true,
  stepperActions = [],
}: {
  allowHtml?: boolean;
  checklistActions?: readonly string[];
  hostActions: readonly string[];
  imageHosts?: readonly string[];
  richBlocks?: boolean;
  stepperActions?: readonly string[];
}): string => {
  const isDefault =
    richBlocks &&
    hostActions.length === 0 &&
    !allowHtml &&
    imageHosts.length === 0 &&
    stepperActions.length === 0 &&
    checklistActions.length === 0;
  if (isDefault) {
    return TERRENO_UI_BLOCKS_SYSTEM_PROMPT;
  }
  return blocksPromptSection({
    allowHtml,
    checklistActions,
    hostActions,
    imageHosts,
    richBlocks,
    stepperActions,
  });
};

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

export const ASK_FILES_TOOL_DESCRIPTION =
  "Ask the user to upload one or more files, such as a photo of a receipt, a signed PDF, or a " +
  "CSV export. The chat shows a file picker limited to the types in accept, and this tool's " +
  "result lists each file's filename, mimeType, and size, followed by the files themselves: " +
  "images and PDFs as they are, text, CSV, and JSON as text. Use it when you need the file's " +
  "contents; ask for a typed value with a form instead.";

/** The line before each file of a `files` answer in the tool result the model sees. */
export const askFileHeading = ({
  count,
  filename,
  mimeType,
  position,
  size,
}: {
  count: number;
  filename: string;
  mimeType: string;
  position: number;
  size: number;
}): string => `File ${position} of ${count}: ${filename} (${mimeType}, ${size} bytes)`;

/** The note after a text file of a `files` answer that was cut to fit. */
export const truncatedAskFileNote = ({
  keptBytes,
  totalBytes,
}: {
  keptBytes: number;
  totalBytes: number;
}): string => `[The file is cut to its first ${keptBytes} of ${totalBytes} bytes.]`;

/** The note naming the uploads of a `files` answer that a host's own replay could not load. */
export const unloadedAskUploadsNote = (uploads: unknown[]): string =>
  `Uploads not loaded here: ${JSON.stringify(uploads)}`;

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

/** Observability test-multi-stage workflow: first parallel-style LLM pass. */
export const OBS_TEST_MULTI_STAGE_CALL_1_SYSTEM =
  "Summarize the user input in one short phrase. Return a JSON object that matches the output " +
  'schema {"phrase": string}. No markdown fences and no extra keys.';

/** Observability test-multi-stage workflow: second LLM pass over the same input. */
export const OBS_TEST_MULTI_STAGE_CALL_2_SYSTEM =
  "Extract exactly two keywords from the user input. Return a JSON object that matches the output " +
  'schema {"keywords": [string, string]}. No markdown fences and no extra keys.';

/** Observability test-multi-stage workflow: final synthesis LLM pass. */
export const OBS_TEST_MULTI_STAGE_FINAL_SYSTEM =
  "Combine the stage-one phrase, stage-two keywords, and text metrics into one concise sentence. " +
  "Return a JSON object that matches the output schema " +
  '{"sentence": string, "phrase": string, "keywords": string[], "metrics": object}. ' +
  "Echo phrase, keywords, and metrics from the prompt. No markdown fences and no extra keys.";

/**
 * Opens the chat's `## Skills` catalog. The catalog lines (`- <name>: <description>`) follow it,
 * so this text must not contain lines that start with "- ".
 */
export const SKILLS_CATALOG_SYSTEM_PROMPT =
  "## Skills\n" +
  "Skills are saved instructions for particular tasks. When the user's request matches a skill " +
  "below, call load_skill with its name before you answer, then follow the instructions it " +
  "returns. Load only the skills the request needs. A skill's files are listed by ref; do not " +
  "show refs to the user.";

export const LOAD_SKILL_TOOL_DESCRIPTION =
  "Load a skill by name. Returns the skill's full instructions and its reference files " +
  "({ref, filename, mimeType}), or {error} when no skill has that name. Call it when the user's " +
  "request matches a skill in the Skills section, then follow the instructions.";

/** Heading of a skill the user named with a leading `/name`; its instructions follow it. */
export const activeSkillHeading = (name: string): string =>
  `## Active skill: ${name}\nThe user asked for this skill. Follow these instructions for this reply.`;

/** Lists an active skill's reference files by ref, so the model can pass them to other tools. */
export const activeSkillFilesLine = (refs: string[]): string => `Files: ${refs.join(", ")}`;

export const GENERATE_IMAGE_TOOL_DESCRIPTION =
  "Generate one image from a text prompt. The user sees the image in the chat as soon as it is " +
  "made, so do not describe or link it. Pass references (at most 4) to steer the style or " +
  "content: skill file refs such as skill:<name>/<filename>, or attachment:<key> for an image " +
  "the user uploaded. Returns {images: [{id, mimeType}]}, or {error}.";
