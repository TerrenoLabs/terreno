import {BlocksView, Box, Button, TextArea} from "@terreno/ui";
import type React from "react";
import {useState} from "react";

const LAYOUT = `v: 1
blocks:
  - type: heading
    size: lg
    text: Signups this quarter
  - type: text
    markdown: Signups grew **12%** quarter over quarter.
  - type: metric
    label: Total
    value: "403"
    delta: "+12%"
    trend: up
`;

const INVALID = `v: 1
blocks:
  - type: heading
    text: Hello
    color: primary
`;

const PRESETS = {
  Invalid: INVALID,
  Layout: LAYOUT,
} as const;

/** Edit a whole-reply document and see it render. Presets match the golden fixtures. */
export const BlocksPlaygroundDemo: React.FC = () => {
  const [document, setDocument] = useState<string>(PRESETS.Layout);
  return (
    <Box gap={3} padding={4} width="100%">
      <Box direction="row" gap={2}>
        <Button onClick={() => setDocument(PRESETS.Layout)} text="Layout" variant="outline" />
        <Button onClick={() => setDocument(PRESETS.Invalid)} text="Invalid" variant="outline" />
      </Box>
      <TextArea
        onChange={setDocument}
        placeholder="Paste a block document"
        rows={12}
        value={document}
      />
      <BlocksView document={document} testID="blocks-playground" />
    </Box>
  );
};
