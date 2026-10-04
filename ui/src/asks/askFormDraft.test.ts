import {describe, it} from "bun:test";
import type {AskValidationError, FormAskInput, FormField} from "@terreno/blocks";
import {assert} from "chai";

import {
  formatFormValue,
  formDraftValues,
  formFieldErrorText,
  fromPickerValue,
  initialFormDraft,
  toPickerValue,
} from "./askFormDraft";

const EVERY_TYPE_INPUT: FormAskInput = {
  fields: [
    {default: "Acme", id: "company", label: "Company", type: "text"},
    {id: "notes", label: "Notes", type: "textarea"},
    {id: "email", label: "Email", type: "email"},
    {id: "site", label: "Website", type: "url"},
    {id: "phone", label: "Phone", type: "phone"},
    {default: 12, id: "seats", label: "Seats", type: "number"},
    {default: "2026-10-01", id: "start", label: "Start", type: "date"},
    {id: "remind", label: "Remind at", type: "time"},
  ],
  prompt: "Every type.",
};

const CHOICES_INPUT: FormAskInput = {
  fields: [
    {id: "notify", label: "Notify me", type: "boolean"},
    {default: true, id: "terms", label: "Accept terms", type: "boolean"},
    {
      id: "region",
      label: "Region",
      options: [
        {id: "us", label: "US"},
        {id: "eu", label: "EU"},
      ],
      type: "select",
    },
    {
      default: ["email"],
      id: "channels",
      label: "Channels",
      options: [
        {id: "email", label: "Email"},
        {id: "sms", label: "Text message"},
      ],
      type: "multiselect",
    },
    {default: "2026-10-01T09:30:00-07:00", id: "meeting", label: "Meeting", type: "datetime"},
  ],
  prompt: "Choices.",
};

const field = (input: FormAskInput, id: string): FormField => {
  const found = input.fields.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`No field ${id}`);
  }
  return found;
};

const error = (code: AskValidationError["code"], path: string): AskValidationError => ({
  code,
  fix: "Server fix.",
  message: `Server message for ${path}.`,
  path,
});

describe("initialFormDraft", () => {
  it("starts each field from its default, as the text its control edits", () => {
    assert.deepEqual(initialFormDraft(EVERY_TYPE_INPUT), {
      company: "Acme",
      email: "",
      notes: "",
      phone: "",
      remind: "",
      seats: "12",
      site: "",
      start: "2026-10-01",
    });
  });

  it("starts checkboxes unchecked, selects empty, and multiselects from their defaults", () => {
    assert.deepEqual(initialFormDraft(CHOICES_INPUT), {
      channels: ["email"],
      meeting: "2026-10-01T09:30:00-07:00",
      notify: false,
      region: "",
      terms: true,
    });
  });
});

describe("formDraftValues", () => {
  it("sends the defaults of an untouched form, leaving blank fields out", () => {
    assert.deepEqual(
      formDraftValues({draft: initialFormDraft(EVERY_TYPE_INPUT), input: EVERY_TYPE_INPUT}),
      {company: "Acme", seats: 12, start: "2026-10-01"}
    );
  });

  it("always sends checkboxes, since unchecked is an answer", () => {
    assert.deepEqual(
      formDraftValues({draft: initialFormDraft(CHOICES_INPUT), input: CHOICES_INPUT}),
      {channels: ["email"], meeting: "2026-10-01T09:30:00-07:00", notify: false, terms: true}
    );
  });

  it("trims text, parses numbers, and keeps text that is not a number for validation to reject", () => {
    const draft = {
      ...initialFormDraft(EVERY_TYPE_INPUT),
      company: "  Acme Corp  ",
      email: " ada@example.com ",
      notes: "   ",
      seats: " 1.5 ",
    };
    assert.deepEqual(formDraftValues({draft, input: EVERY_TYPE_INPUT}), {
      company: "Acme Corp",
      email: "ada@example.com",
      seats: 1.5,
      start: "2026-10-01",
    });
    assert.deepEqual(
      formDraftValues({draft: {...draft, seats: "twelve"}, input: EVERY_TYPE_INPUT}).seats,
      "twelve"
    );
    assert.equal(
      formDraftValues({draft: {...draft, seats: "0x10"}, input: EVERY_TYPE_INPUT}).seats,
      "0x10"
    );
    assert.equal(
      formDraftValues({draft: {...draft, seats: "-2"}, input: EVERY_TYPE_INPUT}).seats,
      -2
    );
  });

  it("sends a valid phone number in E.164 and anything else as typed", () => {
    const draft = initialFormDraft(EVERY_TYPE_INPUT);
    assert.equal(
      formDraftValues({draft: {...draft, phone: "(415) 555-2671"}, input: EVERY_TYPE_INPUT}).phone,
      "+14155552671"
    );
    assert.equal(
      formDraftValues({draft: {...draft, phone: "+44 20 7946 0958"}, input: EVERY_TYPE_INPUT})
        .phone,
      "+442079460958"
    );
    assert.equal(
      formDraftValues({draft: {...draft, phone: "555"}, input: EVERY_TYPE_INPUT}).phone,
      "555"
    );
  });
});

describe("date pickers", () => {
  it("round-trips a date through the picker's UTC midnight ISO value", () => {
    assert.equal(
      toPickerValue({timezone: "America/Los_Angeles", type: "date", value: "2026-10-01"}),
      "2026-10-01T00:00:00.000Z"
    );
    assert.equal(
      fromPickerValue({
        iso: "2026-10-01T00:00:00.000Z",
        timezone: "America/Los_Angeles",
        type: "date",
      }),
      "2026-10-01"
    );
  });

  it("reads a time in the picker's timezone as 24-hour HH:mm", () => {
    const iso = toPickerValue({timezone: "America/Los_Angeles", type: "time", value: "21:05"});
    assert.isString(iso);
    assert.equal(
      fromPickerValue({iso: iso as string, timezone: "America/Los_Angeles", type: "time"}),
      "21:05"
    );
    assert.equal(
      fromPickerValue({iso: "2026-10-01T16:30:00.000Z", timezone: "UTC", type: "time"}),
      "16:30"
    );
  });

  it("sends a datetime with the picker timezone's offset", () => {
    assert.equal(
      fromPickerValue({
        iso: "2026-10-01T16:30:00.000Z",
        timezone: "America/Los_Angeles",
        type: "datetime",
      }),
      "2026-10-01T09:30:00-07:00"
    );
    assert.equal(
      toPickerValue({timezone: "UTC", type: "datetime", value: "2026-10-01T09:30:00-07:00"}),
      "2026-10-01T16:30:00.000Z"
    );
  });

  it("treats an empty or unreadable value as no value", () => {
    assert.isUndefined(toPickerValue({timezone: "UTC", type: "date", value: ""}));
    assert.isUndefined(toPickerValue({timezone: "UTC", type: "date", value: "2026-02-30"}));
    assert.equal(fromPickerValue({iso: "", timezone: "UTC", type: "time"}), "");
  });
});

describe("formFieldErrorText", () => {
  const seats: FormField = {
    id: "seats",
    integer: true,
    label: "Seats",
    max: 500,
    min: 1,
    type: "number",
  };

  it("finds the field's error by its path and says how to fix it in plain words", () => {
    assert.equal(
      formFieldErrorText({errors: [error("OUT_OF_RANGE", "content.values.seats")], field: seats}),
      "Enter a number from 1 to 500."
    );
    assert.equal(
      formFieldErrorText({
        errors: [error("FIELD_TYPE_MISMATCH", "content.values.seats")],
        field: seats,
      }),
      "Enter a whole number."
    );
    assert.equal(
      formFieldErrorText({errors: [error("REQUIRED_FIELD", "content.values.seats")], field: seats}),
      "This field is required."
    );
    assert.isUndefined(
      formFieldErrorText({errors: [error("OUT_OF_RANGE", "content.values.seat")], field: seats})
    );
  });

  it("says which bound a one-sided range breaks", () => {
    assert.equal(
      formFieldErrorText({
        errors: [error("OUT_OF_RANGE", "content.values.seats")],
        field: {...seats, max: undefined},
      }),
      "Enter a number of at least 1."
    );
    assert.equal(
      formFieldErrorText({
        errors: [error("OUT_OF_RANGE", "content.values.seats")],
        field: {...seats, min: undefined},
      }),
      "Enter a number of at most 500."
    );
  });

  it("explains format, date, and length errors by field type", () => {
    const cases: [FormField, AskValidationError["code"], string][] = [
      [{id: "a", label: "A", type: "email"}, "FIELD_TYPE_MISMATCH", "Enter a valid email address."],
      [
        {id: "a", label: "A", type: "url"},
        "FIELD_TYPE_MISMATCH",
        "Enter a web address that starts with http:// or https://.",
      ],
      [{id: "a", label: "A", type: "phone"}, "FIELD_TYPE_MISMATCH", "Enter a valid phone number."],
      [{id: "a", label: "A", type: "date"}, "INVALID_DATE", "Enter a real date."],
      [{id: "a", label: "A", type: "time"}, "INVALID_DATE", "Enter a real time."],
      [{id: "a", label: "A", type: "datetime"}, "INVALID_DATE", "Enter a real date and time."],
      [
        {id: "a", label: "A", maxLength: 60, type: "text"},
        "TOO_LONG",
        "Keep this to 60 characters or fewer.",
      ],
      [
        {id: "a", label: "A", minLength: 3, type: "text"},
        "TOO_SHORT",
        "Write at least 3 characters.",
      ],
      [
        {id: "a", label: "A", options: [{id: "x", label: "X"}], type: "select"},
        "OPTION_NOT_OFFERED",
        "Choose one of the options.",
      ],
    ];
    for (const [caseField, code, text] of cases) {
      assert.equal(
        formFieldErrorText({
          errors: [error(code, `content.values.${caseField.id}`)],
          field: caseField,
        }),
        text,
        `${caseField.type} ${code}`
      );
    }
  });

  it("matches an error on one item of a multiselect, and falls back to the server's message", () => {
    const channels = field(CHOICES_INPUT, "channels");
    assert.equal(
      formFieldErrorText({
        errors: [error("DUPLICATE_ID", "content.values.channels[1]")],
        field: channels,
      }),
      "Server message for content.values.channels[1]."
    );
  });
});

describe("formatFormValue", () => {
  it("shows each value the way the user entered it", () => {
    assert.equal(formatFormValue({field: field(CHOICES_INPUT, "notify"), value: false}), "No");
    assert.equal(formatFormValue({field: field(CHOICES_INPUT, "terms"), value: true}), "Yes");
    assert.equal(formatFormValue({field: field(CHOICES_INPUT, "region"), value: "eu"}), "EU");
    assert.equal(
      formatFormValue({field: field(CHOICES_INPUT, "channels"), value: ["sms", "email"]}),
      "Text message, Email"
    );
    assert.equal(
      formatFormValue({field: field(EVERY_TYPE_INPUT, "start"), value: "2026-10-01"}),
      "Oct 1, 2026"
    );
    assert.equal(
      formatFormValue({field: field(EVERY_TYPE_INPUT, "remind"), value: "21:05"}),
      "9:05 PM"
    );
    assert.equal(
      formatFormValue({
        field: field(CHOICES_INPUT, "meeting"),
        value: "2026-10-01T09:30:00-07:00",
      }),
      "Oct 1, 2026, 9:30 AM UTC-7"
    );
    assert.equal(formatFormValue({field: field(EVERY_TYPE_INPUT, "seats"), value: 1200}), "1,200");
  });

  it("shortens long text and shows values it cannot read as sent", () => {
    const notes = field(EVERY_TYPE_INPUT, "notes");
    const shown = formatFormValue({field: notes, value: `${"word ".repeat(40)}end`});
    assert.isAtMost(shown.length, 81);
    assert.isTrue(shown.endsWith("…"));
    assert.equal(formatFormValue({field: notes, value: "Line one\nLine two"}), "Line one Line two");
    assert.equal(
      formatFormValue({field: field(EVERY_TYPE_INPUT, "start"), value: "someday"}),
      "someday"
    );
    assert.equal(formatFormValue({field: field(CHOICES_INPUT, "region"), value: "mars"}), "mars");
  });
});
