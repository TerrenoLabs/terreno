export interface DemoPreviewState {
  background: "default" | "inverse" | "transparent";
  locale: string;
  reducedMotion: boolean;
  rtl: boolean;
  theme: "light" | "dark" | "system";
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
  if (theme === "dark" || theme === "light" || theme === "system") {
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
  for (const [key, value] of Object.entries(previewParamsFromState(state))) {
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
};

/** Every preview key, with "" for defaults so router.setParams can clear a merged query. */
export const previewParamsFromState = (state: DemoPreviewState): Record<string, string> => {
  return {
    background: state.background === "default" ? "" : state.background,
    locale: state.locale === "en" ? "" : state.locale,
    reducedMotion: state.reducedMotion ? "1" : "",
    rtl: state.rtl ? "1" : "",
    theme: state.theme === "light" ? "" : state.theme,
    viewport: state.viewport === "full" ? "" : state.viewport,
  };
};

/** Non-default preview params to carry when opening another demo or dev route. */
export const activePreviewParams = (
  query: Record<string, string | string[] | undefined>
): Record<string, string> => {
  const params = previewParamsFromState(previewStateFromQuery(query));
  return Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== ""));
};
