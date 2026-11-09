import {Box, Heading, Text} from "@terreno/ui";
import React from "react";

import {
  MAIN_FAMILIES,
  readableTextColor,
  SHADE_KEYS,
  STATUS_FAMILIES,
  STATUS_SHADE_KEYS,
} from "./colorUtils";
import {FAMILY_LABELS} from "./paletteTypes";

/**
 * Visual read-out of the whole generated palette: one row per family showing every generated shade
 * (000-900 for the main families, 000/050/100/200 for status). Updates live as anchors or the chat
 * assistant change the palette.
 */

interface SwatchProps {
  shade: string;
  hex: string;
}

const Swatch: React.FC<SwatchProps> = ({shade, hex}) => {
  const textColor = readableTextColor(hex) === "#ffffff" ? "inverted" : "primary";
  return (
    <Box
      alignItems="center"
      dangerouslySetInlineStyle={{__style: {backgroundColor: hex}}}
      flex="grow"
      gap={1}
      justifyContent="center"
      minWidth={56}
      paddingY={3}
    >
      <Text bold color={textColor} size="sm">
        {shade}
      </Text>
      <Text color={textColor} size="sm">
        {hex.replace("#", "").toUpperCase()}
      </Text>
    </Box>
  );
};

interface RampRowProps {
  family: string;
  shades: string[];
  primitives: Record<string, string>;
}

const RampRow: React.FC<RampRowProps> = ({family, shades, primitives}) => {
  return (
    <Box gap={1}>
      <Text bold size="sm">
        {FAMILY_LABELS[family as keyof typeof FAMILY_LABELS]}
      </Text>
      <Box direction="row" overflow="hidden" rounding="md">
        {shades.map((shade) => (
          <Swatch hex={primitives[`${family}${shade}`] ?? "#000000"} key={shade} shade={shade} />
        ))}
      </Box>
    </Box>
  );
};

interface PaletteRampsProps {
  primitives: Record<string, string>;
}

export const PaletteRamps: React.FC<PaletteRampsProps> = ({primitives}) => {
  return (
    <Box gap={4}>
      <Heading size="sm">Generated palette</Heading>
      {MAIN_FAMILIES.map((family) => (
        <RampRow family={family} key={family} primitives={primitives} shades={[...SHADE_KEYS]} />
      ))}
      {STATUS_FAMILIES.map((family) => (
        <RampRow
          family={family}
          key={family}
          primitives={primitives}
          shades={[...STATUS_SHADE_KEYS]}
        />
      ))}
    </Box>
  );
};
