import type {AskCardProps, AskSubmission, ChatAsk} from "@terreno/ui";
import {AskCard, Box, Button, Heading, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

type ChoiceAsk = Extract<ChatAsk, {kind: "choice"}>;
type ConfirmAsk = Extract<ChatAsk, {kind: "confirm"}>;
type MarkdownAsk = Extract<ChatAsk, {kind: "markdown"}>;
type FormAsk = Extract<ChatAsk, {kind: "form"}>;

const SIMULATED_SERVER_DELAY_MS = 600;

const PLAN_ASK: ChoiceAsk = {
  input: {
    default: ["team"],
    options: [
      {description: "Free for one person", id: "starter", label: "Starter"},
      {description: "$20 per seat each month", id: "team", label: "Team"},
      {description: "SSO and a support contract", id: "enterprise", label: "Enterprise"},
    ],
    prompt: "Which plan should I set up for your workspace?",
    select: "one",
    title: "Choose a plan",
  },
  kind: "choice",
  status: "pending",
  toolCallId: "demo-plan",
};

const REGION_ASK: ChoiceAsk = {
  input: {
    options: [
      {description: "Oregon", id: "us-west", label: "US West"},
      {description: "Virginia", id: "us-east", label: "US East"},
      {description: "Frankfurt", id: "eu-central", label: "EU Central"},
      {description: "Singapore", id: "ap-southeast", label: "Asia Pacific"},
      {description: "São Paulo", id: "sa-east", label: "South America"},
    ],
    prompt: "Where should the new database live?",
    select: "one",
    submitLabel: "Use this region",
  },
  kind: "choice",
  status: "pending",
  toolCallId: "demo-region",
};

const TOPPINGS_ASK: ChoiceAsk = {
  input: {
    allowOther: true,
    default: ["cheese", "mushrooms"],
    maxSelected: 3,
    options: [
      {id: "cheese", label: "Extra cheese"},
      {id: "mushrooms", label: "Mushrooms"},
      {id: "olives", label: "Olives"},
      {id: "peppers", label: "Peppers"},
      {description: "Yes, on pizza", id: "pineapple", label: "Pineapple"},
    ],
    otherLabel: "Another topping",
    prompt: "Which toppings should I add? Pick up to three.",
    select: "many",
    submitLabel: "Add toppings",
    title: "Build your pizza",
  },
  kind: "choice",
  status: "pending",
  toolCallId: "demo-toppings",
};

const COUNTRY_NAMES = [
  "Argentina",
  "Australia",
  "Brazil",
  "Canada",
  "Denmark",
  "France",
  "Germany",
  "India",
  "Japan",
  "Mexico",
  "Norway",
  "United States",
];

const COUNTRY_ASK: ChoiceAsk = {
  input: {
    options: COUNTRY_NAMES.map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      label: name,
    })),
    prompt: "Which country should invoices use for tax rules?",
    select: "one",
  },
  kind: "choice",
  status: "pending",
  toolCallId: "demo-country",
};

const ARCHIVE_ASK: ConfirmAsk = {
  input: {
    confirmLabel: "Archive 12 chats",
    denyLabel: "Keep them",
    destructive: true,
    prompt: "Archive the 12 chats older than 90 days? You can't undo this.",
    title: "Archive old chats",
  },
  kind: "confirm",
  status: "pending",
  toolCallId: "demo-archive",
};

const REPORT_ASK: ConfirmAsk = {
  input: {
    confirmLabel: "Send report",
    denyLabel: "Not now",
    prompt: "Send the weekly report to the team now?",
  },
  kind: "confirm",
  status: "pending",
  toolCallId: "demo-report",
};

const ANSWERED_CONFIRMS: ConfirmAsk[] = [
  {
    ...ARCHIVE_ASK,
    response: {action: "accept", content: {confirmed: true}},
    status: "answered",
    toolCallId: "demo-confirmed",
  },
  {
    ...REPORT_ASK,
    response: {action: "accept", content: {confirmed: false}},
    status: "answered",
    toolCallId: "demo-denied",
  },
];

const ANNOUNCEMENT_DRAFT =
  "# We're live\n\nToday we launched **Terreno Asks**: your agent can now ask you a question and wait for the answer.\n\n- Pick from options\n- Approve or deny\n- Edit a draft like this one\n";

const ANNOUNCEMENT_ASK: MarkdownAsk = {
  input: {
    initial: ANNOUNCEMENT_DRAFT,
    maxLength: 600,
    minLength: 40,
    placeholder: "Write the announcement",
    prompt: "Here is a draft of the launch announcement. Edit it, then send it back.",
    submitLabel: "Send it back",
    title: "Launch announcement",
  },
  kind: "markdown",
  status: "pending",
  toolCallId: "demo-announcement",
};

const MARKDOWN_ERRORS: NonNullable<AskCardProps["errors"]> = [
  {
    code: "TOO_LONG",
    fix: "Shorten content.markdown to 600 characters or fewer.",
    message: "The text is 640 characters, but this ask allows at most 600.",
    path: "content.markdown",
  },
];

const RELEASE_NOTES = Array.from(
  {length: 8},
  (_, index) =>
    `- Fixed issue ${index + 1}: the sync outbox now retries failed writes with backoff and keeps their order.`
).join("\n");

const ANSWERED_MARKDOWN: MarkdownAsk[] = [
  {
    ...ANNOUNCEMENT_ASK,
    response: {action: "accept", content: {changed: false, markdown: ANNOUNCEMENT_DRAFT}},
    status: "answered",
    toolCallId: "demo-markdown-approved",
  },
  {
    ...ANNOUNCEMENT_ASK,
    input: {prompt: "Write the release notes for this week."},
    response: {
      action: "accept",
      content: {changed: true, markdown: `# Release notes\n\n${RELEASE_NOTES}`},
    },
    status: "answered",
    toolCallId: "demo-markdown-edited",
  },
  {
    ...ANNOUNCEMENT_ASK,
    response: {action: "decline"},
    status: "answered",
    toolCallId: "demo-markdown-skipped",
  },
];

const INVOICE_ASK: FormAsk = {
  input: {
    fields: [
      {
        helperText: "As it appears on the invoice.",
        id: "company",
        label: "Company name",
        maxLength: 120,
        required: true,
        type: "text",
      },
      {id: "email", label: "Billing email", required: true, type: "email"},
      {id: "seats", integer: true, label: "Seats", max: 500, min: 1, type: "number"},
      {id: "start", label: "Start date", type: "date"},
      {
        default: "us",
        id: "region",
        label: "Region",
        options: [
          {id: "us", label: "United States"},
          {id: "eu", label: "European Union"},
        ],
        type: "select",
      },
      {default: true, id: "notify", label: "Email me the invoice", type: "boolean"},
    ],
    prompt: "A few details for the invoice.",
    submitLabel: "Send details",
    title: "Invoice details",
  },
  kind: "form",
  status: "pending",
  toolCallId: "demo-invoice",
};

const BOOKING_ASK: FormAsk = {
  input: {
    fields: [
      {id: "phone", label: "Callback number", type: "phone"},
      {default: "https://example.com", id: "site", label: "Website", type: "url"},
      {default: "09:30", id: "reminder", label: "Reminder time", type: "time"},
      {default: "2026-10-01T09:30:00-07:00", id: "meeting", label: "Meeting", type: "datetime"},
      {
        default: ["email"],
        id: "channels",
        label: "Reach me by",
        options: [
          {id: "email", label: "Email"},
          {id: "sms", label: "Text message"},
          {id: "call", label: "Phone call"},
        ],
        type: "multiselect",
      },
      {id: "notes", label: "Notes", maxLength: 500, type: "textarea"},
    ],
    prompt: "When should we meet, and how should we reach you?",
    title: "Book a call",
  },
  kind: "form",
  status: "pending",
  toolCallId: "demo-booking",
};

const FORM_ERRORS: NonNullable<AskCardProps["errors"]> = [
  {
    code: "OUT_OF_RANGE",
    fix: "Make content.values.seats at most 500.",
    message: "content.values.seats is 900, above the field's max of 500.",
    path: "content.values.seats",
  },
  {
    code: "INVALID_DATE",
    fix: 'Write content.values.start as YYYY-MM-DD, such as "2026-10-01".',
    message: 'content.values.start "2026-02-30" is not a real date in YYYY-MM-DD.',
    path: "content.values.start",
  },
];

const ANSWERED_FORMS: FormAsk[] = [
  {
    ...INVOICE_ASK,
    response: {
      action: "accept",
      content: {
        values: {
          company: "Acme Corp",
          email: "billing@acme.example",
          notify: true,
          region: "eu",
          seats: 12,
          start: "2026-10-01",
        },
      },
    },
    status: "answered",
    toolCallId: "demo-form-sent",
  },
  {
    ...INVOICE_ASK,
    response: {action: "decline"},
    status: "answered",
    toolCallId: "demo-form-skipped",
  },
];

const SERVER_ERRORS: NonNullable<AskCardProps["errors"]> = [
  {
    code: "OPTION_NOT_OFFERED",
    fix: "Choose one of the listed plans.",
    message: "That plan is no longer offered. Choose one of the listed plans.",
    path: "content.selected[0]",
  },
];

const ANSWERED_ASKS: ChoiceAsk[] = [
  {
    ...PLAN_ASK,
    response: {action: "accept", content: {selected: ["team"]}},
    status: "answered",
    toolCallId: "demo-answered",
  },
  {
    ...TOPPINGS_ASK,
    response: {action: "accept", content: {other: "Basil", selected: ["cheese", "olives"]}},
    status: "answered",
    toolCallId: "demo-answered-many",
  },
  {
    ...PLAN_ASK,
    response: {action: "decline"},
    status: "answered",
    toolCallId: "demo-declined",
  },
  {
    ...PLAN_ASK,
    response: {action: "cancel", reason: "user_sent_message"},
    status: "cancelled",
    toolCallId: "demo-cancelled",
  },
  {
    ...PLAN_ASK,
    response: {action: "cancel", reason: "one_ask_at_a_time"},
    status: "cancelled",
    toolCallId: "demo-dropped",
  },
];

const waitForServer = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, SIMULATED_SERVER_DELAY_MS);
  });

/** Answers locally after a short delay, then shows the card's answered summary. */
const InteractiveAsk: React.FC<{ask: ChatAsk; testID: string}> = ({ask, testID}) => {
  const [current, setCurrent] = useState<ChatAsk>(ask);

  const handleSubmit = useCallback(async ({response}: AskSubmission): Promise<void> => {
    await waitForServer();
    setCurrent((previous) => ({...previous, response, status: "answered"}));
  }, []);

  const handleReset = useCallback((): void => {
    setCurrent(ask);
  }, [ask]);

  return (
    <Box gap={2}>
      <AskCard ask={current} onSubmit={handleSubmit} testID={testID} />
      {current.status === "pending" ? null : (
        <Box direction="row">
          <Button onClick={handleReset} text="Ask again" variant="outline" />
        </Box>
      )}
    </Box>
  );
};

const StorySection: React.FC<{children: React.ReactNode; note: string; title: string}> = ({
  children,
  note,
  title,
}) => (
  <Box gap={2} maxWidth={560} width="100%">
    <Heading size="sm">{title}</Heading>
    <Text color="secondaryDark" size="sm">
      {note}
    </Text>
    {children}
  </Box>
);

export const AskCardDemo: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="Three short options fit a simple card, so each is a button and a tap answers. The demo answers locally; there is no AI backend."
      title="Pick one"
    >
      <InteractiveAsk ask={PLAN_ASK} testID="demo-ask-card" />
    </StorySection>
  );
};

export const AskCardRadio: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="Up to eight options render as radio buttons with Submit and Skip."
      title="Radio options"
    >
      <InteractiveAsk ask={REGION_ASK} testID="demo-ask-card-radio" />
    </StorySection>
  );
};

export const AskCardSearchable: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="More than eight options render as a searchable select."
      title="Searchable options"
    >
      <InteractiveAsk ask={COUNTRY_ASK} testID="demo-ask-card-searchable" />
    </StorySection>
  );
};

export const AskCardPickMany: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="select many renders checkboxes with the selection bounds, plus an Other field when the ask allows it. Other counts as one choice, and Submit stays disabled until the answer fits the bounds."
      title="Pick many with Other"
    >
      <InteractiveAsk ask={TOPPINGS_ASK} testID="demo-ask-card-many" />
    </StorySection>
  );
};

export const AskCardConfirmDestructive: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="confirm with destructive: the approve button comes first in the destructive style, and the deny button last. No Skip, because deny is the negative answer."
      title="Confirm a destructive action"
    >
      <InteractiveAsk ask={ARCHIVE_ASK} testID="demo-ask-card-confirm-destructive" />
    </StorySection>
  );
};

export const AskCardConfirm: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="confirm without destructive: the approve button is primary. Set allowDecline to add Skip after the deny button."
      title="Confirm an action"
    >
      <InteractiveAsk ask={REPORT_ASK} testID="demo-ask-card-confirm" />
    </StorySection>
  );
};

export const AskCardConfirmAnswered: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="An answered confirm collapses to one line that names the pressed button."
      title="Confirmed and declined"
    >
      <Box gap={2}>
        {ANSWERED_CONFIRMS.map((ask) => (
          <AskCard ask={ask} key={ask.toolCallId} testID={ask.toolCallId} />
        ))}
      </Box>
    </StorySection>
  );
};

export const AskCardConfirmReadOnly: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="Without onSubmit both confirm buttons are disabled."
      title="Confirm, read only"
    >
      <Box gap={2}>
        <AskCard ask={ARCHIVE_ASK} testID="demo-ask-card-confirm-read-only" />
        <AskCard ask={REPORT_ASK} testID="demo-ask-card-confirm-read-only-report" />
      </Box>
    </StorySection>
  );
};

export const AskCardMarkdown: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="markdown opens a markdown editor on the agent's draft, with a preview and a length hint. Submit sends the text back with changed saying whether it differs from the draft."
      title="Edit a draft"
    >
      <InteractiveAsk ask={ANNOUNCEMENT_ASK} testID="demo-ask-card-markdown" />
    </StorySection>
  );
};

export const AskCardMarkdownError: React.FC = (): React.ReactElement => {
  const handleSubmit = useCallback(async (): Promise<void> => {
    await waitForServer();
  }, []);

  return (
    <StorySection
      note="A server error about the text shows under the editor. The draft stays editable."
      title="Draft rejected by the server"
    >
      <AskCard
        ask={ANNOUNCEMENT_ASK}
        errors={MARKDOWN_ERRORS}
        onSubmit={handleSubmit}
        testID="demo-ask-card-markdown-error"
      />
    </StorySection>
  );
};

export const AskCardMarkdownAnswered: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="An answered markdown ask says whether the user approved or edited the draft and shows the text. Long text shows a preview until Show all."
      title="Approved, edited, and skipped drafts"
    >
      <Box gap={2}>
        {ANSWERED_MARKDOWN.map((ask) => (
          <AskCard ask={ask} key={ask.toolCallId} testID={ask.toolCallId} />
        ))}
      </Box>
    </StorySection>
  );
};

export const AskCardForm: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="form renders one field per entry, with the control for its type. Submit stays disabled until required fields are filled and every value fits its field; a field says what is wrong once you edit it."
      title="Fill in a form"
    >
      <Box gap={4}>
        <InteractiveAsk ask={INVOICE_ASK} testID="demo-ask-card-form" />
        <InteractiveAsk ask={BOOKING_ASK} testID="demo-ask-card-form-booking" />
      </Box>
    </StorySection>
  );
};

export const AskCardFormError: React.FC = (): React.ReactElement => {
  const handleSubmit = useCallback(async (): Promise<void> => {
    await waitForServer();
  }, []);

  return (
    <StorySection
      note="Server errors for a field show on that field, in plain words. Errors for no field show under the form."
      title="Form rejected by the server"
    >
      <AskCard
        ask={INVOICE_ASK}
        errors={FORM_ERRORS}
        onSubmit={handleSubmit}
        testID="demo-ask-card-form-error"
      />
    </StorySection>
  );
};

export const AskCardFormAnswered: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="A sent form counts the fields it filled in and lists each one as label and value."
      title="Sent and skipped forms"
    >
      <Box gap={2}>
        {ANSWERED_FORMS.map((ask) => (
          <AskCard ask={ask} key={ask.toolCallId} testID={ask.toolCallId} />
        ))}
      </Box>
    </StorySection>
  );
};

export const AskCardError: React.FC = (): React.ReactElement => {
  const handleSubmit = useCallback(async (): Promise<void> => {
    await waitForServer();
  }, []);

  return (
    <StorySection
      note="Errors from the server, such as the fields of a 400, show under the controls. The ask stays answerable."
      title="Server error"
    >
      <AskCard
        ask={REGION_ASK}
        errors={SERVER_ERRORS}
        onSubmit={handleSubmit}
        testID="demo-ask-card-error"
      />
    </StorySection>
  );
};

export const AskCardAnswered: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="After an answer, skip, or cancel, the card collapses to one line in the transcript."
      title="Answered, skipped, and cancelled"
    >
      <Box gap={2}>
        {ANSWERED_ASKS.map((ask) => (
          <AskCard ask={ask} key={ask.toolCallId} testID={ask.toolCallId} />
        ))}
      </Box>
    </StorySection>
  );
};

export const AskCardReadOnly: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="Without onSubmit the card still shows the question, but it cannot be answered: buttons are disabled and radio and checkbox options show as plain text."
      title="Read only"
    >
      <Box gap={2}>
        <AskCard ask={PLAN_ASK} testID="demo-ask-card-read-only" />
        <AskCard ask={REGION_ASK} testID="demo-ask-card-read-only-radio" />
        <AskCard ask={TOPPINGS_ASK} testID="demo-ask-card-read-only-many" />
      </Box>
    </StorySection>
  );
};
