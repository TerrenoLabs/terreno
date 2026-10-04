import {type FC, useCallback, useEffect, useState} from "react";
import {View} from "react-native";

import {Button} from "./Button";
import type {AiSuggestionProps, ThumbsUpDownFeedbackValue} from "./Common";
import {SparklesIcon} from "./icons/SparklesIcon";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {ThumbsUpDownFeedback} from "./ThumbsUpDownFeedback";

export interface AiSuggestionBoxProps extends AiSuggestionProps {
  testID?: string;
}

/**
 * Inline AI suggestion box rendered inside TextField/TextArea via the `aiSuggestion` prop.
 *
 * Expansion is derived from the persisted `status` (`ready` expands; `hidden` and `added`
 * condense into the collapsed header row), but an explicit user Show/Hide toggle always
 * wins — including while a hide/show mutation is still in flight — so a quick
 * Hide-then-Show never snaps back to collapsed when the earlier hide's refetch lands.
 * Hide/Show on a non-`added` suggestion also invoke `onHide`/`onShow` so consumers can
 * persist the choice; toggling an `added` suggestion is purely local so the acceptance
 * record is never reset. "Add to note" stays available after a first add for re-adds.
 */
export const AiSuggestionBox: FC<AiSuggestionBoxProps> = ({
  status,
  text,
  onAdd,
  onHide,
  onShow,
  onFeedback,
  feedback,
  notStartedText = "AI note will be generated once the session ends.",
  generatingText = "AI note generation in progress...",
  testID,
}) => {
  const {theme} = useTheme();
  // The user's last explicit Show/Hide choice. While set, it overrides the
  // status-derived default so in-flight hide/show mutations can't undo a newer click.
  const [expandedIntent, setExpandedIntent] = useState<boolean | null>(null);

  // Reconcile the local intent with persisted status transitions. Accepting a suggestion
  // (`added`) always condenses the box, and once the persisted status agrees with the
  // user's intent the override is dropped so later transitions (e.g. a regenerated
  // suggestion flipping back to `ready`) use their status defaults. An intent that
  // disagrees with the incoming status is kept — that status is a stale in-flight
  // hide/show landing after a newer click, and must not undo it.
  useEffect(() => {
    setExpandedIntent((current) => {
      if (current === null || status === "added") {
        return null;
      }
      return current === (status === "ready") ? null : current;
    });
  }, [status]);

  const expanded = expandedIntent ?? status === "ready";
  const isAdded = status === "added";

  const backgroundColor = isAdded
    ? theme.surface.successLight
    : status === "not-started"
      ? theme.surface.baseAlternate
      : theme.surface.ai;

  const borderColor = isAdded
    ? theme.border.success
    : status === "not-started"
      ? theme.border.default
      : theme.border.ai;

  const containerStyle = {
    backgroundColor,
    borderColor,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 8,
    width: "100%" as const,
  };

  const headingText =
    status === "not-started"
      ? notStartedText
      : status === "generating"
        ? generatingText
        : isAdded
          ? "AI-generated note added!"
          : expanded
            ? "AI-generated note"
            : "AI-generated note (hidden)";

  const handleHide = useCallback(() => {
    setExpandedIntent(false);
    // Persist the hide for any non-`added` suggestion — even when the status still reads
    // `hidden` locally (an un-hide may be in flight). Hiding an `added` suggestion is a
    // purely local collapse so the acceptance record stays intact.
    if (status !== "added") {
      onHide?.();
    }
  }, [status, onHide]);

  const handleShow = useCallback(() => {
    setExpandedIntent(true);
    // Persist the un-hide for any non-`added` suggestion — even when the status still
    // reads `ready` locally (a hide may be in flight, and this Show must override it).
    // Expanding an `added` suggestion must not reset its status.
    if (status !== "added") {
      onShow?.();
    }
  }, [status, onShow]);

  const handleFeedbackChange = useCallback(
    (nextValue?: ThumbsUpDownFeedbackValue) => {
      if (!onFeedback) {
        return;
      }
      // ThumbsUpDownFeedback already clears a repeated selection, so undefined means "no feedback".
      onFeedback(nextValue === undefined ? null : nextValue === "positive" ? "like" : "dislike");
    },
    [onFeedback]
  );

  const renderFeedback = () => (
    <ThumbsUpDownFeedback
      onChange={handleFeedbackChange}
      testID={testID ? `${testID}-feedback` : undefined}
      value={feedback === "like" ? "positive" : feedback === "dislike" ? "negative" : undefined}
    />
  );

  if (status === "not-started" || status === "generating") {
    return (
      <View style={containerStyle} testID={testID}>
        <View style={{alignItems: "center", flexDirection: "row", gap: 4, width: "100%"}}>
          <SparklesIcon fill={theme.text.secondaryDark} />
          <View style={{flex: 1}}>
            <Text color={isAdded ? "primary" : "secondaryDark"} size="sm">
              {headingText}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (!expanded) {
    return (
      <View style={{...containerStyle, flexDirection: "column"}} testID={testID}>
        <View style={{alignItems: "center", flexDirection: "row", gap: 4, width: "100%"}}>
          <SparklesIcon fill={theme.text.secondaryDark} />
          <View style={{flex: 1}}>
            <Text color="secondaryDark" size="sm">
              {headingText}
            </Text>
          </View>
          <View style={{alignItems: "center", flexDirection: "row", gap: 4}}>
            <Button
              onClick={handleShow}
              size="sm"
              testID={testID ? `${testID}-show` : undefined}
              text="Show"
              variant="outline"
            />
            {renderFeedback()}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{...containerStyle, alignItems: "flex-end"}} testID={testID}>
      <View style={{alignItems: "center", flexDirection: "row", gap: 4, width: "100%"}}>
        <SparklesIcon fill={theme.text.secondaryDark} />
        <View style={{flex: 1}}>
          <Text color={isAdded ? "primary" : "secondaryDark"} size="sm">
            {headingText}
          </Text>
        </View>
        {renderFeedback()}
      </View>

      {Boolean(text) && (
        <View style={{paddingBottom: 4, width: "100%"}}>
          <Text size="md">{text}</Text>
        </View>
      )}

      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
          justifyContent: "flex-end",
          width: "100%",
        }}
      >
        <Button
          onClick={handleHide}
          size="sm"
          testID={testID ? `${testID}-hide` : undefined}
          text="Hide"
          variant="outline"
        />
        {Boolean(onAdd) && (
          <Button
            onClick={onAdd!}
            size="sm"
            testID={testID ? `${testID}-add` : undefined}
            text="Add to note"
            variant="secondary"
          />
        )}
      </View>
    </View>
  );
};
