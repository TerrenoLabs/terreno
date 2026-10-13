import {normalizeHex, type PaletteAnchors} from "./colorUtils";
import {BODY_FONTS, type FontSelection, HEADING_FONTS} from "./fonts";
import {ANCHOR_FAMILIES, type ChatMessage, FAMILY_LABELS} from "./paletteTypes";

/**
 * Minimal browser/native client for the Gemini Developer API (the API-key based
 * `generativelanguage.googleapis.com` service). The palette generator calls this directly with a
 * user-supplied key so the demo app needs no backend. The model's only job is to pick a set of
 * anchor colors (one hex per family); deterministic color math in `colorUtils` expands those
 * anchors into the full 000-900 ramps, so the palette is always smooth and WCAG-checkable.
 */

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Curated fallback models (Gemini 3 family) for the picker when the live model list cannot be
 * fetched. When an API key is set, `listGeminiModels` replaces these with the live set for the key.
 */
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-pro-image",
];

const MAX_MODEL_LIST_PAGES = 10;
const MODEL_LIST_PAGE_SIZE = "200";
const GENERATE_CONTENT_METHOD = "generateContent";

interface GeminiApiModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

/** Strip the "models/" resource prefix from a Gemini model name. */
const normalizeGeminiModelId = (name: string): string => {
  return name.trim().replace(/^models\//, "");
};

/**
 * List chat-capable models available to a Gemini Developer API key, so the model picker reflects the
 * live set for that key (mirrors `listGeminiApiModels` in `@terreno/ai`). Returns `undefined` when
 * the list can't be retrieved (missing key, network error, non-200), so callers fall back to
 * `DEFAULT_GEMINI_MODELS`.
 */
export const listGeminiModels = async ({
  apiKey,
  baseUrl,
  fetchImpl,
}: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<string[] | undefined> => {
  if (!apiKey) {
    return undefined;
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    return undefined;
  }

  const resolvedBase = baseUrl ?? GEMINI_API_BASE_URL;
  const models: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const url = new URL(`${resolvedBase}/models`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", MODEL_LIST_PAGE_SIZE);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await doFetch(url.toString());
      if (!response.ok) {
        return undefined;
      }

      const body = (await response.json()) as {
        models?: GeminiApiModel[];
        nextPageToken?: string;
      };
      for (const model of body.models ?? []) {
        if (!model.name) {
          continue;
        }
        if (!(model.supportedGenerationMethods ?? []).includes(GENERATE_CONTENT_METHOD)) {
          continue;
        }
        models.push(normalizeGeminiModelId(model.name));
      }
      pageToken = body.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_MODEL_LIST_PAGES);
  } catch {
    return undefined;
  }

  return models;
};

/** System instruction: describes the assistant's role, the required output, and worked examples. */
const COLOR_SYSTEM_PROMPT = `You are an expert product designer and color systemist who builds accessible UI color palettes.

You design palettes for a React Native design system with seven color families:
- neutral: grays used for text, borders, and page backgrounds.
- primary: the main brand/action color used for buttons and links.
- secondary: a supporting brand color for headers and secondary surfaces.
- accent: a warm highlight color used sparingly for emphasis.
- error: red, for destructive/error states.
- warning: orange/amber, for cautionary states.
- success: green, for positive states.

The error, warning, success, and neutral families are automatically constrained to their
conventional tones (red, orange/amber, green, and low-saturation gray, respectively), so keep their
anchors within those tones — any out-of-tone hue you return will be snapped back. primary,
secondary, and accent are free brand colors with no tone restriction.

For EACH family you return exactly ONE anchor hex color. The design system will automatically
generate the lighter and darker 000-900 shades from your anchor, so pick a mid-tone (~500 level)
that reads well as the core of the family. The anchor you give is preserved verbatim, so choose it
carefully with WCAG AA contrast in mind:
- The neutral anchor's DARKEST shade is used for body text on a white page — keep neutral dark and
  close to gray (low saturation).
- primary, secondary, error, warning, and success anchors are used as button/surface fills with
  WHITE text on top, so prefer anchors dark enough that white text on them clears 4.5:1 contrast.

Interpret vibe/keyword requests thoughtfully and iterate when the user gives feedback (e.g. "make
it warmer", "too saturated", "swap primary to teal"). Always keep the whole palette cohesive.

Examples of the kind of requests you will get and how to reason about them:
- "I want a warm, earthy palette" -> primary in terracotta/amber, secondary in olive/brown,
  accent in mustard, neutrals slightly warm.
- "Stylish modern SaaS with indigo as the primary color" -> indigo primary, cool slate secondary,
  a vivid accent (e.g. violet or cyan), crisp near-neutral grays.
- "Calm, trustworthy healthcare app" -> teal/blue primary, muted green secondary, soft accent,
  clean light-gray neutrals.

You also recommend a font pairing that fits the palette's mood: a "headingFont" for
titles/display and a "bodyFont" for body copy and UI. Choose from these Google Fonts only.
Heading fonts: ${HEADING_FONTS.join(", ")}.
Body fonts: ${BODY_FONTS.join(", ")}.
Pick a pairing with clear contrast between heading and body, and briefly justify it in
"fontRationale".

Respond ONLY with a JSON object. Include every family key, a short "explanation" (1-3 sentences)
describing the palette's mood and any accessibility trade-offs you made, plus "headingFont",
"bodyFont", and "fontRationale".`;

/** Shape the Gemini responseSchema so the model always returns parseable anchors. */
const RESPONSE_SCHEMA = {
  properties: {
    accent: {description: "Anchor hex for the accent family", type: "string"},
    bodyFont: {description: "Recommended body font family", type: "string"},
    error: {description: "Anchor hex for the error family", type: "string"},
    explanation: {description: "Short description of the palette and trade-offs", type: "string"},
    fontRationale: {description: "Why this font pairing fits the palette", type: "string"},
    headingFont: {description: "Recommended heading font family", type: "string"},
    neutral: {description: "Anchor hex for the neutral family, e.g. #4E4E4E", type: "string"},
    primary: {description: "Anchor hex for the primary family", type: "string"},
    secondary: {description: "Anchor hex for the secondary family", type: "string"},
    success: {description: "Anchor hex for the success family", type: "string"},
    warning: {description: "Anchor hex for the warning family", type: "string"},
  },
  required: [...ANCHOR_FAMILIES, "explanation"],
  type: "object",
} as const;

export interface GeminiPaletteResponse {
  anchors: PaletteAnchors;
  explanation: string;
  fonts: FontSelection;
  fontRationale?: string;
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {parts?: GeminiPart[]};
}

interface GeminiResponseBody {
  candidates?: GeminiCandidate[];
  error?: {message?: string};
}

/** Build the running "current palette" context so the model iterates instead of starting over. */
const buildAnchorContext = (anchors: PaletteAnchors, fonts: FontSelection): string => {
  const lines = ANCHOR_FAMILIES.map(
    (family) => `- ${FAMILY_LABELS[family]}: ${anchors[family]}`
  ).join("\n");
  return `The current palette anchors are:\n${lines}\n\nCurrent fonts: heading "${fonts.headingFont}", body "${fonts.bodyFont}".\n\nUpdate them based on the latest request. Keep families and fonts the user did not mention unless a cohesive change requires it.`;
};

const mapRoleToGemini = (role: ChatMessage["role"]): "user" | "model" => {
  return role === "assistant" ? "model" : "user";
};

/**
 * Send the conversation plus the current anchors to Gemini and parse the returned anchor set.
 * Invalid or missing hex values fall back to the current anchor for that family so a partial model
 * response never corrupts the palette.
 */
export const generatePaletteFromChat = async ({
  apiKey,
  model,
  messages,
  currentAnchors,
  currentFonts,
  fetchImpl,
}: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  currentAnchors: PaletteAnchors;
  currentFonts: FontSelection;
  fetchImpl?: typeof fetch;
}): Promise<GeminiPaletteResponse> => {
  if (!apiKey) {
    throw new Error("A Gemini API key is required. Add your key above to generate palettes.");
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!doFetch) {
    throw new Error("No fetch implementation available in this environment.");
  }

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      parts: [{text: message.text}],
      role: mapRoleToGemini(message.role),
    }));

  // Prepend the current-palette context as a user turn so the model always has fresh state.
  const contents = [
    {parts: [{text: buildAnchorContext(currentAnchors, currentFonts)}], role: "user" as const},
    ...conversation,
  ];

  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await doFetch(url, {
    body: JSON.stringify({
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.9,
      },
      systemInstruction: {parts: [{text: COLOR_SYSTEM_PROMPT}]},
    }),
    headers: {"Content-Type": "application/json"},
    method: "POST",
  });

  const body = (await response.json()) as GeminiResponseBody;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Gemini request failed (${response.status}).`);
  }

  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed: Partial<
    Record<
      keyof PaletteAnchors | "explanation" | "headingFont" | "bodyFont" | "fontRationale",
      string
    >
  >;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Could not parse the palette Gemini returned. Try rephrasing your request.");
  }

  const anchors = {...currentAnchors};
  for (const family of ANCHOR_FAMILIES) {
    const normalized = normalizeHex(parsed[family] ?? "");
    if (normalized) {
      anchors[family] = normalized;
    }
  }

  const fonts: FontSelection = {
    bodyFont: parsed.bodyFont?.trim() || currentFonts.bodyFont,
    headingFont: parsed.headingFont?.trim() || currentFonts.headingFont,
  };

  return {
    anchors,
    explanation: parsed.explanation ?? "Updated the palette.",
    fontRationale: parsed.fontRationale?.trim() || undefined,
    fonts,
  };
};
