import {type Block, parseBlocks, validateBlocks} from "@terreno/blocks";
import {BlocksView, Box, Button, SelectField, TextArea, useToast} from "@terreno/ui";
import type React from "react";
import {useCallback, useMemo, useState} from "react";

import {resolveBlocksPhoto} from "./blocksPhotos";
import {type PlaygroundActionEvent, runPlaygroundAction} from "./blocksPlaygroundHost";
import {
  BLOCK_TYPE_PRESETS,
  MAIN_PRESETS,
  PLAYGROUND_HOST_ACTIONS,
  PRESETS,
  type PresetName,
} from "./blocksPlaygroundPresets";

const MAIN_PRESET_NAMES = Object.keys(MAIN_PRESETS) as (keyof typeof MAIN_PRESETS)[];

const BLOCK_TYPE_OPTIONS = Object.keys(BLOCK_TYPE_PRESETS)
  .sort()
  .map((type) => ({label: type, value: type}));

interface BlocksPlaygroundDemoProps {
  /** Preset shown first. */
  initialPreset?: PresetName;
}

/** Replacement blocks from local stepper and checklist round trips, for one document text. */
interface LocalOverrides {
  document: string;
  overrides: Record<string, Block>;
}

const parsedDocument = (text: string): ReturnType<typeof validateBlocks> | undefined => {
  const parsed = parseBlocks(text);
  return parsed.ok ? validateBlocks(parsed.value, {allowHtml: true}) : undefined;
};

/**
 * Edit a whole-reply document and see it render. There is no server: stepper and checklist
 * callbacks run on the device with the `@terreno/blocks` helpers the server host actions use,
 * and every other action shows a toast describing the event.
 */
export const BlocksPlaygroundDemo: React.FC<BlocksPlaygroundDemoProps> = ({
  initialPreset = "Layout",
}) => {
  const toast = useToast();
  const [document, setDocument] = useState<string>(PRESETS[initialPreset]);
  const [blockType, setBlockType] = useState<string>("");
  const [local, setLocal] = useState<LocalOverrides>({document, overrides: {}});
  // Overrides belong to the text they were computed from; editing the text drops them.
  const overrides = local.document === document ? local.overrides : undefined;
  const validated = useMemo(() => parsedDocument(document), [document]);

  const choosePreset = useCallback((name: PresetName): void => {
    setDocument(PRESETS[name]);
  }, []);

  const handleBlockType = useCallback(
    (value: string): void => {
      setBlockType(value);
      if (value in BLOCK_TYPE_PRESETS) {
        choosePreset(value as PresetName);
      }
    },
    [choosePreset]
  );

  const handleAction = useCallback(
    (event: PlaygroundActionEvent): void => {
      const result = runPlaygroundAction({
        document: validated?.ok ? validated.doc : undefined,
        event,
      });
      if (result.override !== undefined) {
        const {block, blockId} = result.override;
        setLocal((current) => ({
          document,
          overrides: {
            ...(current.document === document ? current.overrides : {}),
            [blockId]: block,
          },
        }));
      }
      toast.info(result.message, {id: "blocks-playground-action"});
    },
    [document, toast, validated]
  );

  return (
    <Box gap={3} padding={4} width="100%">
      <Box direction="row" gap={2} wrap>
        {MAIN_PRESET_NAMES.map((name) => (
          <Button
            key={name}
            onClick={() => {
              setBlockType("");
              choosePreset(name);
            }}
            testID={`blocks-playground-preset-${name.toLowerCase().replace(/ /g, "-")}`}
            text={name}
            variant="outline"
          />
        ))}
      </Box>
      <SelectField
        helperText="Load a preset that shows one block type."
        onChange={handleBlockType}
        options={BLOCK_TYPE_OPTIONS}
        placeholder="Choose a block type"
        testID="blocks-playground-block-type"
        title="Block type"
        value={blockType}
      />
      <TextArea
        onChange={setDocument}
        placeholder="Paste a block document"
        rows={12}
        testID="blocks-playground-editor"
        value={document}
      />
      <BlocksView
        allowHtml
        document={document}
        hostActions={PLAYGROUND_HOST_ACTIONS}
        onAction={handleAction}
        overrides={overrides}
        resolveImage={resolveBlocksPhoto}
        testID="blocks-playground"
      />
    </Box>
  );
};
