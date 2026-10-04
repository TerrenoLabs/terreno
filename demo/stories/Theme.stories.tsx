import {
  Box,
  Button,
  darkThemeConfig,
  Field,
  Heading,
  IconButton,
  SelectField,
  Text,
  ThemeContext,
} from "@terreno/ui";
import {useContext, useState} from "react";

type ThemeName = "default" | "pink" | "dark";

export const ThemeComponentStories = () => {
  const [themeName, setThemeName] = useState<ThemeName>("default");
  const {resetTheme, setPrimitives, setTheme} = useContext(ThemeContext);

  return (
    <Box
      color="base"
      direction="column"
      display="flex"
      justifyContent="around"
      marginLeft={2}
      marginTop={12}
      padding={4}
      width={300}
    >
      <Box paddingY={2}>
        <SelectField
          onChange={(value: string) => {
            const nextTheme = value as ThemeName;
            setThemeName(nextTheme);
            resetTheme();
            if (nextTheme === "pink") {
              setPrimitives({
                primary400: "#e0218a",
                secondary100: "#ed5c9b",
                secondary500: "#f18dbc",
              });
            } else if (nextTheme === "dark") {
              setTheme(darkThemeConfig);
            }
          }}
          options={[
            {label: "Default", value: "default"},
            {label: "Pink", value: "pink"},
            {label: "Dark", value: "dark"},
          ]}
          value={themeName}
        />
      </Box>
      <Box>
        <Heading>Heading</Heading>
        <Text>Text</Text>
      </Box>
      <Box paddingY={1}>
        <Button onClick={() => {}} text="primary" variant="primary" />
      </Box>
      <Box paddingY={1}>
        <Button onClick={() => {}} text="secondary" variant="secondary" />
      </Box>
      <Box paddingY={1}>
        <Button onClick={() => {}} text="muted" variant="muted" />
      </Box>
      <Box paddingY={1}>
        <Button onClick={() => {}} text="outline" variant="outline" />
      </Box>
      <Box paddingY={1}>
        <Button onClick={() => {}} text="destructive" variant="destructive" />
      </Box>
      <Box direction="row" justifyContent="between" paddingY={2} width="100%">
        <IconButton
          accessibilityLabel=""
          iconName="spaghetti-monster-flying"
          onClick={() => {}}
          variant="primary"
        />
        <IconButton
          accessibilityLabel=""
          iconName="user-astronaut"
          onClick={() => {}}
          variant="secondary"
        />
        <IconButton accessibilityLabel="" iconName="soap" onClick={() => {}} variant="secondary" />
        <IconButton
          accessibilityLabel=""
          iconName="people-roof"
          onClick={() => {}}
          variant="secondary"
        />
      </Box>
    </Box>
  );
};

// TODO: Font change story is not working
export const ThemeFontStories = () => {
  const [font, setFont] = useState<string | undefined>();
  const {resetTheme, setTheme} = useContext(ThemeContext);
  const fonts = ["Comfortaa-Light", "Comfortaa-Bold", "IMFellEnglishSC", "DancingScript-Regular"];

  return (
    <Box
      color="base"
      direction="column"
      display="flex"
      height={300}
      justifyContent="around"
      padding={4}
      width={300}
    >
      <SelectField
        onChange={(value: string | undefined) => {
          if (!value) {
            resetTheme();
            return;
          }
          setFont(value);
          setTheme({
            font: {
              primary: value,
              title: value,
            },
          });
        }}
        options={fonts.map((f) => ({label: f, value: f}))}
        value={font}
      />
      <Heading>This is a heading</Heading>
      <Text>This is some text in a new font</Text>
      <Text bold>And some bolded text in a new font</Text>
      <Button onClick={() => {}} text="Some Button Text" variant="primary" />
      <Field
        helperText="Here's some help text"
        onChange={(): void => {}}
        placeholder="Placeholder text"
        title="Text Field"
        type="text"
        value=""
      />
    </Box>
  );
};
