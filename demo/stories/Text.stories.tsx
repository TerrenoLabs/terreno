import {Box, Link, Text, type TextColor, type TextProps} from "@terreno/ui";
import type React from "react";

import {StorybookContainer} from "./StorybookContainer";

export const TextPreview = (): React.ReactElement => {
  return (
    <Box direction="column" gap={1} width="100%">
      {renderText("Default text", {})}
      {renderText("Small", {size: "sm"})}
      {renderText("Large", {size: "lg"})}
      {renderText("Bold", {bold: true})}
      {renderText("Italic", {italic: true})}
      {renderText("Accent", {color: "accent"})}
      {renderText("Error", {color: "error"})}
      {renderText("Success", {color: "success"})}
    </Box>
  );
};

export const renderText = (text: string, props: Partial<TextProps>) => {
  return (
    <Box key={text} paddingY={1} width="100%">
      <Text {...props}>{text}</Text>
    </Box>
  );
};

export const Texts = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box direction="column" display="flex" height="100%" width="100%">
        {renderText("default", {})}
        {renderText("small", {size: "sm"})}
        {renderText("large", {size: "lg"})}
        {[
          "primary",
          "secondaryLight",
          "extraLight",
          "secondaryDark",
          "link",
          "linkLight",
          "accent",
          "error",
          "warning",
          "success",
        ].map((color) => renderText(color, {color: color as TextColor}))}

        {renderText("bold", {bold: true})}
        {renderText("italic", {italic: true})}
        {renderText("bold italic", {bold: true, italic: true})}
        {renderText("bold italic accent", {bold: true, color: "accent", italic: true})}

        {renderText("center", {align: "center"})}
        <Link href="https://github.com/TerrenoLabs/terreno" text="Linked Text" />
      </Box>
    </StorybookContainer>
  );
};

export const Truncate = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box maxWidth={160}>
        <Box marginBottom={2}>
          <Text bold>normal:</Text>
          <Text>
            This is a long and Supercalifragilisticexpialidocious sentence.
            次の単語グレートブリテンおよび北アイルランド連合王国で本当に大きな言葉&#39;
          </Text>
        </Box>
        <Box marginBottom={2}>
          <Text bold>truncate:</Text>
          <Text truncate>
            This is a long and Supercalifragilisticexpialidocious sentence.
            次の単語グレートブリテンおよび北アイルランド連合王国で本当に大きな言葉
            ｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ&#39;
          </Text>
        </Box>
      </Box>
    </StorybookContainer>
  );
};

export const TextLinks = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box direction="column" display="flex" height="100%" width="100%">
        <Text>Go to google: https://google.com they have stuff.</Text>
        <Text>Here is my email: josh@example.com.</Text>
        <Text skipLinking>No link here: https://google.com.</Text>
      </Box>
    </StorybookContainer>
  );
};
