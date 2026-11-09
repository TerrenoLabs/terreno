import {DemoConfig} from "@config";
import {
  Badge,
  BooleanField,
  Box,
  Button,
  Card,
  Heading,
  SegmentedControl,
  SelectField,
  Text,
  TextField,
  type ThemePrimitiveColors,
  ThemeProvider,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {View} from "react-native";

import {ErrorBoundary} from "../ErrorBoundary";
import type {ThemeMode} from "./paletteTypes";

/**
 * Live preview of real Terreno components rendered under the generated palette, in light or dark
 * mode. A nested `ThemeProvider` (keyed by the palette + mode so it re-initializes on every change)
 * scopes the palette to this subtree only. Two views are offered: a hand-built "showcase" mini-app
 * and the full grid of every component demo.
 */

interface ComponentPreviewProps {
  primitives: Partial<ThemePrimitiveColors>;
}

const CARD_WIDTH = 260;
const CARD_PREVIEW_HEIGHT = 160;

const ShowcaseCard: React.FC = () => {
  const [checked, setChecked] = useState<boolean>(true);
  const [segment, setSegment] = useState<number>(0);
  const [text, setText] = useState<string>("");
  const [choice, setChoice] = useState<string>("one");

  return (
    <Box gap={4}>
      <Box gap={2}>
        <Heading size="lg">The quick brown fox</Heading>
        <Text>
          This paragraph shows body copy on the base surface. Adjust the anchors or ask the
          assistant for a new vibe and everything below re-themes instantly.
        </Text>
        <Text color="link">A themed link within the copy.</Text>
      </Box>

      <Box direction="row" gap={2} wrap>
        <Button onClick={() => {}} text="Primary" variant="primary" />
        <Button onClick={() => {}} text="Secondary" variant="secondary" />
        <Button onClick={() => {}} text="Outline" variant="outline" />
        <Button onClick={() => {}} text="Muted" variant="muted" />
        <Button onClick={() => {}} text="Destructive" variant="destructive" />
      </Box>

      <Box direction="row" gap={2} wrap>
        <Badge status="info" value="Info" />
        <Badge status="success" value="Success" />
        <Badge status="warning" value="Warning" />
        <Badge status="error" value="Error" />
        <Badge status="neutral" value="Neutral" />
      </Box>

      <SegmentedControl
        items={["Overview", "Details", "Activity"]}
        onChange={setSegment}
        selectedIndex={segment}
      />

      <Card>
        <Box gap={3} padding={2}>
          <Heading size="sm">Sign in</Heading>
          <TextField onChange={setText} placeholder="you@example.com" title="Email" value={text} />
          <SelectField
            onChange={setChoice}
            options={[
              {label: "Option one", value: "one"},
              {label: "Option two", value: "two"},
            ]}
            title="Plan"
            value={choice}
          />
          <BooleanField onChange={setChecked} title="Keep me signed in" value={checked} />
          <Button fullWidth onClick={() => {}} text="Continue" variant="primary" />
        </Box>
      </Card>
    </Box>
  );
};

const AllComponentsGrid: React.FC = () => {
  return (
    <Box direction="row" gap={3} overflow="hidden" width="100%" wrap>
      {DemoConfig.map((config) => {
        if (!config.name || !config.demo) {
          return null;
        }
        return (
          <View
            key={config.name}
            style={{
              borderColor: "#ccc",
              borderRadius: 4,
              borderWidth: 1,
              // Clamp to the container so a narrow preview column never overflows horizontally.
              maxWidth: "100%",
              overflow: "hidden",
              width: CARD_WIDTH,
            }}
          >
            <Box
              alignItems="center"
              color="neutralLight"
              height={CARD_PREVIEW_HEIGHT}
              justifyContent="center"
              overflow="hidden"
              padding={3}
            >
              <ErrorBoundary>{config.demo({preview: true})}</ErrorBoundary>
            </Box>
            <Box color="base" padding={2}>
              <Text bold size="sm">
                {config.name}
              </Text>
            </Box>
          </View>
        );
      })}
    </Box>
  );
};

export const ComponentPreview: React.FC<ComponentPreviewProps> = ({primitives}) => {
  const [view, setView] = useState<number>(0);
  const [mode, setMode] = useState<ThemeMode>("light");

  // Remount the themed subtree whenever the palette or mode changes so the nested ThemeProvider
  // re-reads its initial primitives (it only consumes `initialPrimitives` on mount) and re-applies
  // the correct role mapping from a clean default.
  const paletteKey = useMemo(() => `${mode}-${JSON.stringify(primitives)}`, [mode, primitives]);

  const handleViewChange = useCallback((index: number): void => {
    setView(index);
  }, []);

  const handleModeChange = useCallback((index: number): void => {
    setMode(index === 1 ? "dark" : "light");
  }, []);

  const baseHex =
    mode === "dark"
      ? ((primitives as Record<string, string>).neutral800 ?? "#353535")
      : ((primitives as Record<string, string>).neutral000 ?? "#ffffff");

  return (
    <Box gap={4}>
      <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
        <Heading size="sm">Component preview</Heading>
        <Box direction="row" gap={2} wrap>
          <Box minWidth={160}>
            <SegmentedControl
              items={["Light", "Dark"]}
              onChange={handleModeChange}
              selectedIndex={mode === "dark" ? 1 : 0}
            />
          </Box>
          <Box minWidth={200}>
            <SegmentedControl
              items={["Showcase", "All"]}
              onChange={handleViewChange}
              selectedIndex={view}
            />
          </Box>
        </Box>
      </Box>
      <Box
        dangerouslySetInlineStyle={{__style: {backgroundColor: baseHex}}}
        padding={4}
        rounding="md"
      >
        <ThemeProvider colorScheme={mode} initialPrimitives={primitives} key={paletteKey}>
          {view === 0 ? <ShowcaseCard /> : <AllComponentsGrid />}
        </ThemeProvider>
      </Box>
    </Box>
  );
};
