export interface DemoPreviewState {
  background: "default" | "inverse" | "transparent";
  locale: string;
  reducedMotion: boolean;
  rtl: boolean;
  theme: "light" | "dark";
  viewport: "full" | "320" | "375" | "1024" | "1280";
}

const VIEWPORTS = new Set(["full", "320", "375", "1024", "1280"]);
const BACKGROUNDS = new Set(["default", "inverse", "transparent"]);

export const defaultPreviewState = (): DemoPreviewState => {
  return {
    background: "default",
    locale: "en",
    reducedMotion: false,
    rtl: false,
    theme: "light",
    viewport: "full",
  };
};

const one = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

export const previewStateFromQuery = (
  query: Record<string, string | string[] | undefined>
): DemoPreviewState => {
  const state = defaultPreviewState();
  const theme = one(query.theme);
  if (theme === "dark" || theme === "light") {
    state.theme = theme;
  }
  const viewport = one(query.viewport);
  if (VIEWPORTS.has(viewport)) {
    state.viewport = viewport as DemoPreviewState["viewport"];
  }
  const background = one(query.background);
  if (BACKGROUNDS.has(background)) {
    state.background = background as DemoPreviewState["background"];
  }
  const locale = one(query.locale);
  if (locale) {
    state.locale = locale;
  }
  state.rtl = one(query.rtl) === "1";
  state.reducedMotion = one(query.reducedMotion) === "1";
  return state;
};

export const previewQueryFromState = (state: DemoPreviewState): string => {
  const params = new URLSearchParams();
  if (state.theme !== "light") {
    params.set("theme", state.theme);
  }
  if (state.viewport !== "full") {
    params.set("viewport", state.viewport);
  }
  if (state.background !== "default") {
    params.set("background", state.background);
  }
  if (state.locale !== "en") {
    params.set("locale", state.locale);
  }
  if (state.rtl) {
    params.set("rtl", "1");
  }
  if (state.reducedMotion) {
    params.set("reducedMotion", "1");
  }
  return params.toString();
};
