/**
 * Hard limits for asks. The schemas, the prompt section, the docs, and the tests all read these
 * values, so change them here only.
 */
export const ASK_LIMITS = {
  cancelReasonMaxLength: 200,
  choice: {
    optionDescriptionMaxLength: 280,
    optionIdMaxLength: 64,
    /** Must allow exactly `optionIdMaxLength` characters. */
    optionIdPattern: /^[a-z0-9][a-z0-9_-]{0,63}$/,
    optionLabelMaxLength: 120,
    optionsMax: 50,
    optionsMin: 2,
    otherMaxLength: 500,
  },
  pendingAsksPerHistory: 1,
  promptMaxLength: 500,
  simpleCard: {
    buttonLabelMaxLength: 20,
    buttonsMax: 3,
    textMaxLength: 140,
    titleMaxLength: 40,
  },
  submitLabelMaxLength: 24,
  titleMaxLength: 80,
} as const;
