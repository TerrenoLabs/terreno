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
  confirm: {
    /** Every confirm label fits a simple card button uncut. */
    labelMaxLength: 20,
  },
  files: {
    /** The per-file cap when the host sets no `maxFileSizeBytes`, matching `/files/upload`. */
    defaultMaxFileSizeBytes: 10 * 1024 * 1024,
    filenameMaxLength: 255,
    maxFiles: 10,
    minFiles: 1,
    /** Text, CSV, and JSON files reach the model cut to this many bytes, with a note. */
    textMaxBytes: 100_000,
  },
  form: {
    fieldsMax: 8,
    fieldsMin: 1,
    helperTextMaxLength: 280,
    labelMaxLength: 120,
    /** The fewest and most digits in a `phone` value. */
    phoneDigitsMax: 15,
    phoneDigitsMin: 7,
    /** The cap on a `textarea` value and on a `textarea` field's `maxLength`. */
    textareaMaxLength: 10_000,
    /** The cap on a `text`, `email`, `url`, or `phone` value, and on a `text` field's `maxLength`. */
    textMaxLength: 2000,
  },
  markdown: {
    /** The cap on `initial`, on `maxLength`, and on every answer. */
    maxLength: 20_000,
    placeholderMaxLength: 120,
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
