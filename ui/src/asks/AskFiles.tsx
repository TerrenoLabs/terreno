import {
  type AskFileAccept,
  type AskResponse,
  type AskValidationError,
  acceptedFileMimeTypes,
  type FilesAskInput,
  filesCountBounds,
  validateAskResponse,
} from "@terreno/blocks";
import type React from "react";
import {useCallback, useMemo, useState} from "react";

import {AttachmentPreview} from "../AttachmentPreview";
import {Box} from "../Box";
import {Button} from "../Button";
import {FilePickerButton, type SelectedFile} from "../FilePickerButton";
import {Text} from "../Text";
import {type AskControlProps, AskErrors, SkipButton, useAnswerButton} from "./askControls";
import {type AskFilesResolver, normalizeMimeType, resolveAskFilesAsDataUrls} from "./askFileRefs";
import type {ChatAsk} from "./askTypes";

const SUBMIT_ACTION_ID = "submit";

/** Stands in for the ref a picked file gets on Submit, so the draft can be checked before then. */
const DRAFT_FILE_ID = "selected";

const ACCEPT_LABELS: Record<AskFileAccept, string> = {
  csv: "CSV files",
  image: "images",
  json: "JSON files",
  pdf: "PDFs",
  text: "text files",
};

const RESOLVE_ERROR = "The files could not be sent. Try again, or pick them again.";

/** The host `errors` the user changed the selection under, so they no longer describe it. */
interface ChangedSinceErrors {
  errors?: AskValidationError[];
}

export interface AskFilesProps extends AskControlProps {
  ask: Extract<ChatAsk, {kind: "files"}>;
  /** Turns the picked files into the answer's refs on Submit. Defaults to data URLs. */
  resolveFiles?: AskFilesResolver;
}

const listLabels = (labels: string[]): string => {
  if (labels.length <= 1) {
    return labels.join("");
  }
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
};

/** "Up to 3 files: images, PDFs or text files." from the ask's counts and types. */
const filesHint = (input: FilesAskInput): string => {
  const {max, min} = filesCountBounds(input);
  const noun = (count: number): string => (count === 1 ? "file" : "files");
  let count = `${min} to ${max} ${noun(max)}`;
  if (min === max) {
    count = `${max} ${noun(max)}`;
  } else if (min === 1) {
    count = `Up to ${max} ${noun(max)}`;
  }
  return `${count}: ${listLabels(input.accept.map((accept) => ACCEPT_LABELS[accept]))}.`;
};

/** The answer the picked files would send, with stand-in ids, for checking before Submit. */
const draftOf = (files: SelectedFile[]): AskResponse => ({
  action: "accept",
  content: {
    files: files.map((file) => ({
      fileId: DRAFT_FILE_ID,
      filename: file.name,
      mimeType: normalizeMimeType(file.mimeType),
      size: file.size ?? 0,
    })),
  },
});

/**
 * Pick files and send them. The picker offers the ask's accepted types, the picked files show
 * with a remove control, and Submit is enabled once their count and types fit the ask. On Submit,
 * `resolveFiles` turns them into refs (uploads or data URLs) before the answer is sent.
 */
export const AskFiles: React.FC<AskFilesProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  resolveFiles = resolveAskFilesAsDataUrls,
  testID,
}) => {
  const {input} = ask;
  const {max} = filesCountBounds(input);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>(undefined);
  const [changedSinceErrors, setChangedSinceErrors] = useState<ChangedSinceErrors | undefined>(
    undefined
  );
  const serverErrors = changedSinceErrors?.errors === errors ? [] : (errors ?? []);
  const isAnswering = pendingActionId !== undefined || isResolving;
  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});
  const mimeTypes = useMemo(() => acceptedFileMimeTypes(input.accept), [input.accept]);

  const draftErrors = useMemo((): AskValidationError[] => {
    if (files.length === 0) {
      return [];
    }
    return validateAskResponse({input, kind: "files", response: draftOf(files)});
  }, [files, input]);

  const handleFilesSelected = useCallback(
    (picked: SelectedFile[]): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setResolveError(undefined);
      setChangedSinceErrors({errors});
      setFiles((current) => [...current, ...picked]);
    },
    [errors, isAnswering, isDisabled]
  );

  const handleRemove = useCallback(
    (index: number): void => {
      if (isDisabled || isAnswering) {
        return;
      }
      setResolveError(undefined);
      setChangedSinceErrors({errors});
      setFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
    },
    [errors, isAnswering, isDisabled]
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    setIsResolving(true);
    setResolveError(undefined);
    let refs: Awaited<ReturnType<AskFilesResolver>>;
    try {
      refs = await resolveFiles(files);
    } catch (error) {
      console.warn("[AskFiles] Preparing the files failed", {error, toolCallId: ask.toolCallId});
      setResolveError(RESOLVE_ERROR);
      setIsResolving(false);
      return;
    }
    setIsResolving(false);
    await onAnswer({
      actionId: SUBMIT_ACTION_ID,
      response: {action: "accept", content: {files: refs}},
    });
  }, [ask.toolCallId, files, onAnswer, resolveFiles]);

  const isSubmitting = isResolving || pendingActionId === SUBMIT_ACTION_ID;
  return (
    <Box gap={3}>
      <Text color="secondaryDark" size="sm" testID={`${testID}-hint`}>
        {filesHint(input)}
      </Text>
      <Box alignSelf="start">
        <FilePickerButton
          disabled={isDisabled || isAnswering || files.length >= max}
          documentTypes={mimeTypes}
          includeImages={input.accept.includes("image")}
          multiple={max > 1}
          onFilesSelected={handleFilesSelected}
          testID={`${testID}-picker`}
          text={files.length === 0 ? "Choose files" : "Add files"}
        />
      </Box>
      <AttachmentPreview
        attachments={files}
        onRemove={handleRemove}
        testID={`${testID}-selected`}
      />
      <AskErrors errors={[...draftErrors, ...serverErrors]} testID={`${testID}-errors`} />
      {resolveError ? (
        <Text color="error" size="sm" testID={`${testID}-resolve-error`}>
          {resolveError}
        </Text>
      ) : null}
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={
            isDisabled ||
            files.length === 0 ||
            draftErrors.length > 0 ||
            (isAnswering && !isSubmitting)
          }
          loading={isSubmitting}
          onClick={handleSubmit}
          testID={`${testID}-submit`}
          text={input.submitLabel ?? "Submit"}
          wrapText
        />
        <SkipButton ask={ask} renderButton={renderButton} />
      </Box>
    </Box>
  );
};
