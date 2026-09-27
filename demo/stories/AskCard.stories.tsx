import type {AskCardProps, AskSubmission, ChatAsk} from "@terreno/ui";
import {AskCard, Box, Button, Heading, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

type ChoiceAsk = Extract<ChatAsk, {kind: "choice"}>;

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
const InteractiveAsk: React.FC<{ask: ChoiceAsk; testID: string}> = ({ask, testID}) => {
  const [current, setCurrent] = useState<ChoiceAsk>(ask);

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
      note="Without onSubmit the card still shows the question, but it cannot be answered: buttons are disabled and radio options show as plain text."
      title="Read only"
    >
      <Box gap={2}>
        <AskCard ask={PLAN_ASK} testID="demo-ask-card-read-only" />
        <AskCard ask={REGION_ASK} testID="demo-ask-card-read-only-radio" />
      </Box>
    </StorySection>
  );
};
