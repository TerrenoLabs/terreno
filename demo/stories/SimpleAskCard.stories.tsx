import {type SimpleCard, type SimpleCardButton, simpleCardSchema} from "@terreno/blocks";
import emojiLabelCut from "@terreno/blocks/fixtures/valid/choice-emoji-label-cut.json";
import labelsCollideAfterCut from "@terreno/blocks/fixtures/valid/choice-labels-collide-after-cut.json";
import longTextCut from "@terreno/blocks/fixtures/valid/choice-long-text-cut.json";
import manyDefaultBelowMin from "@terreno/blocks/fixtures/valid/choice-many-default-below-min.json";
import manyEveryChoiceWithOther from "@terreno/blocks/fixtures/valid/choice-many-every-choice-with-other.json";
import manyNoDefault from "@terreno/blocks/fixtures/valid/choice-many-no-default.json";
import manyOptionalNoButtons from "@terreno/blocks/fixtures/valid/choice-many-optional-no-buttons.json";
import manyOptionsDefaultLabelCollides from "@terreno/blocks/fixtures/valid/choice-many-options-default-label-collides.json";
import manyOptionsNoButtons from "@terreno/blocks/fixtures/valid/choice-many-options-no-buttons.json";
import manyOptionsNoDefault from "@terreno/blocks/fixtures/valid/choice-many-options-no-default.json";
import manyOptionsWithDefault from "@terreno/blocks/fixtures/valid/choice-many-options-with-default.json";
import manyRequiredWithDefault from "@terreno/blocks/fixtures/valid/choice-many-required-with-default.json";
import manySinglePickOrOther from "@terreno/blocks/fixtures/valid/choice-many-single-pick-or-other.json";
import manyToppingsWithDefault from "@terreno/blocks/fixtures/valid/choice-many-toppings-with-default.json";
import maxLimits from "@terreno/blocks/fixtures/valid/choice-max-limits.json";
import planWithDefault from "@terreno/blocks/fixtures/valid/choice-plan-with-default.json";
import twoOptions from "@terreno/blocks/fixtures/valid/choice-two-options.json";
import twoOptionsNoDecline from "@terreno/blocks/fixtures/valid/choice-two-options-no-decline.json";
import {Box, Button, Heading, SimpleAskCard, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

/** Apple Watch 45 mm screen size, in points. */
const WATCH_FRAME_WIDTH = 198;
const WATCH_FRAME_HEIGHT = 242;

const SIMULATED_SERVER_DELAY_MS = 600;

/**
 * Every valid ask fixture in `@terreno/blocks`, by file name. `SimpleAskCard.stories.test.tsx`
 * fails when a fixture is missing here, so a new fixture shows up in the gallery.
 */
const FIXTURES: Record<string, {simple: unknown}> = {
  "choice-emoji-label-cut": emojiLabelCut,
  "choice-labels-collide-after-cut": labelsCollideAfterCut,
  "choice-long-text-cut": longTextCut,
  "choice-many-default-below-min": manyDefaultBelowMin,
  "choice-many-every-choice-with-other": manyEveryChoiceWithOther,
  "choice-many-no-default": manyNoDefault,
  "choice-many-optional-no-buttons": manyOptionalNoButtons,
  "choice-many-options-default-label-collides": manyOptionsDefaultLabelCollides,
  "choice-many-options-no-buttons": manyOptionsNoButtons,
  "choice-many-options-no-default": manyOptionsNoDefault,
  "choice-many-options-with-default": manyOptionsWithDefault,
  "choice-many-required-with-default": manyRequiredWithDefault,
  "choice-many-single-pick-or-other": manySinglePickOrOther,
  "choice-many-toppings-with-default": manyToppingsWithDefault,
  "choice-max-limits": maxLimits,
  "choice-plan-with-default": planWithDefault,
  "choice-two-options": twoOptions,
  "choice-two-options-no-decline": twoOptionsNoDecline,
};

const FIXTURE_CARDS = Object.entries(FIXTURES).map(([name, fixture]) => ({
  card: simpleCardSchema.parse(fixture.simple),
  name,
}));

const PLAN_CARD: SimpleCard = simpleCardSchema.parse(planWithDefault.simple);

const waitForServer = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, SIMULATED_SERVER_DELAY_MS);
  });

/** The body a watch posts to `/gpt/histories/{id}/turn` when this button is tapped. */
const turnBody = (card: SimpleCard, button: SimpleCardButton): string =>
  JSON.stringify({buttonId: button.id, surface: "compact", toolCallId: card.toolCallId});

const noop = (): void => {};

/**
 * A 198×242 pt screen in a rounded bezel, with a caption below. Content taller than the screen
 * scrolls, as on a watch. The bezel carries the border so the screen keeps its exact size.
 */
const WatchFrame: React.FC<{children: React.ReactNode; label: string; testID: string}> = ({
  children,
  label,
  testID,
}) => (
  <Box alignSelf="start" gap={1}>
    <Box border="dark" overflow="hidden" rounding="xl">
      <Box color="base" height={WATCH_FRAME_HEIGHT} testID={testID} width={WATCH_FRAME_WIDTH}>
        <Box flex="grow" scroll>
          <Box padding={3}>{children}</Box>
        </Box>
      </Box>
    </Box>
    <Box maxWidth={WATCH_FRAME_WIDTH}>
      <Text color="secondaryDark" size="sm">
        {label}
      </Text>
    </Box>
  </Box>
);

const StorySection: React.FC<{children: React.ReactNode; note: string; title: string}> = ({
  children,
  note,
  title,
}) => (
  <Box gap={2} width="100%">
    <Heading size="sm">{title}</Heading>
    <Box maxWidth={560}>
      <Text color="secondaryDark" size="sm">
        {note}
      </Text>
    </Box>
    {children}
  </Box>
);

export const SimpleAskCardDemo: React.FC = (): React.ReactElement => {
  const [pendingButtonId, setPendingButtonId] = useState<string | undefined>(undefined);
  const [sentButton, setSentButton] = useState<SimpleCardButton | undefined>(undefined);

  const handlePress = useCallback(async (button: SimpleCardButton): Promise<void> => {
    setPendingButtonId(button.id);
    await waitForServer();
    setPendingButtonId(undefined);
    setSentButton(button);
  }, []);

  const handleReset = useCallback((): void => {
    setSentButton(undefined);
  }, []);

  return (
    <StorySection
      note="The ask as an Apple Watch 45 mm screen shows it. Each button carries its exact answer, so a tap sends only the button id. The demo answers locally; there is no AI backend."
      title="On a watch"
    >
      <WatchFrame label="Apple Watch 45 mm" testID="demo-watch-frame">
        {sentButton ? (
          <Box gap={2}>
            <Text>Sent “{sentButton.label}”.</Text>
            <Button fullWidth onClick={handleReset} text="Ask again" variant="outline" />
          </Box>
        ) : (
          <SimpleAskCard
            card={PLAN_CARD}
            onPress={handlePress}
            pendingButtonId={pendingButtonId}
            testID="demo-simple-ask-card"
          />
        )}
      </WatchFrame>
      {sentButton ? (
        <Box maxWidth={560} testID="demo-watch-turn-body">
          <Text color="secondaryDark" size="sm">
            {`POST /gpt/histories/{id}/turn ${turnBody(PLAN_CARD, sentButton)}`}
          </Text>
        </Box>
      ) : null}
    </StorySection>
  );
};

export const SimpleAskCardFixtures: React.FC = (): React.ReactElement => {
  return (
    <StorySection
      note="Every valid ask fixture in @terreno/blocks, drawn at Apple Watch 45 mm size (198×242 pt). A card that cannot offer every answer says to continue on the phone. Long cards scroll."
      title="Every fixture"
    >
      <Box direction="row" gap={4} wrap>
        {FIXTURE_CARDS.map(({card, name}) => (
          <WatchFrame key={name} label={name} testID={`watch-frame-${name}`}>
            <SimpleAskCard card={card} onPress={noop} testID={`simple-ask-card-${name}`} />
          </WatchFrame>
        ))}
      </Box>
    </StorySection>
  );
};
