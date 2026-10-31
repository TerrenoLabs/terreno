import {
  Badge,
  BooleanField,
  Box,
  Button,
  Card,
  FilePickerButton,
  Heading,
  IconButton,
  Modal,
  Page,
  type SelectedFile,
  Spinner,
  selectedFileMimeType,
  Text,
  TextField,
} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {Platform} from "react-native";

import {
  type GetGptSkillsRes,
  useDeleteGptSkillsByIdMutation,
  useGetGptSkillsQuery,
  useGetMeQuery,
  usePostGptSkillsMutation,
  usePostGptSkillsUploadMutation,
} from "@/store/sdk";

type SkillRow = NonNullable<GetGptSkillsRes["data"]>[number];

// The browser's file dialog filters by extension; native pickers only understand MIME types.
const SKILL_DOCUMENT_TYPES =
  Platform.OS === "web"
    ? [".md", ".zip", "text/markdown", "application/zip"]
    : ["text/markdown", "text/plain", "application/zip", "application/octet-stream"];

/** The API's `title` from a failed RTK Query call, so errors read the way the server wrote them. */
const errorTitle = (error: unknown, fallback: string): string => {
  const title = (error as {data?: {title?: unknown}} | undefined)?.data?.title;
  return typeof title === "string" && title.length > 0 ? title : fallback;
};

/** The multipart body for a picked skill file, built like ai.tsx's `/files/upload` form. */
const skillUploadFormData = async (file: SelectedFile, isGlobal: boolean): Promise<FormData> => {
  const form = new FormData();
  // Text parts go before the file so the server has `scope` when it reads the file.
  if (isGlobal) {
    form.append("scope", "global");
  }
  const type = selectedFileMimeType(file);
  if (Platform.OS !== "web") {
    form.append("file", {name: file.name, type, uri: file.uri} as unknown as Blob);
    return form;
  }
  const blob = await (await fetch(file.uri)).blob();
  form.append("file", new Blob([blob], {type}), file.name);
  return form;
};

/**
 * The signed-in user's GPT skills: their own skills plus the skills an admin installed for
 * everyone. Users create a skill from a form or upload a `SKILL.md` / `.zip`, and delete their
 * own. Admins can install a skill for everyone.
 */
const SkillsScreen: React.FC = () => {
  const router = useRouter();
  const {data: profile} = useGetMeQuery();
  const isAdmin = profile?.admin === true;
  const {data: skillsResponse, error: listError, isLoading} = useGetGptSkillsQuery({limit: 200});
  const [createSkill, {isLoading: isCreating}] = usePostGptSkillsMutation();
  const [uploadSkill, {isLoading: isUploading}] = usePostGptSkillsUploadMutation();
  const [deleteSkill] = useDeleteGptSkillsByIdMutation();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<SkillRow | undefined>();

  const skills = useMemo((): SkillRow[] => skillsResponse?.data ?? [], [skillsResponse]);
  // An enabled global skill wins over a user skill with the same name in chat, so mark the user's copy.
  const globalNames = useMemo(
    (): Set<string> =>
      new Set(
        skills
          .filter((skill) => skill.scope === "global" && skill.enabled !== false)
          .map((skill) => skill.name)
      ),
    [skills]
  );

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const resetForm = useCallback((): void => {
    setName("");
    setDescription("");
    setInstructions("");
    setFormError(undefined);
  }, []);

  const handleOpenForm = useCallback((): void => {
    resetForm();
    setIsFormOpen(true);
  }, [resetForm]);

  const handleCancelForm = useCallback((): void => {
    resetForm();
    setIsFormOpen(false);
  }, [resetForm]);

  const handleSave = useCallback(async (): Promise<void> => {
    setFormError(undefined);
    try {
      await createSkill({
        description,
        instructions,
        name,
        ...(isAdmin && isGlobal ? {scope: "global" as const} : {}),
      }).unwrap();
      resetForm();
      setIsFormOpen(false);
      setIsGlobal(false);
    } catch (error) {
      console.warn("Failed to create skill", error);
      setFormError(errorTitle(error, "Could not save the skill"));
    }
  }, [createSkill, description, instructions, isAdmin, isGlobal, name, resetForm]);

  const handleFilesSelected = useCallback(
    async (files: SelectedFile[]): Promise<void> => {
      const [file] = files;
      if (!file) {
        return;
      }
      setActionError(undefined);
      try {
        await uploadSkill(await skillUploadFormData(file, isAdmin && isGlobal)).unwrap();
        setIsGlobal(false);
      } catch (error) {
        console.warn("Failed to upload skill", error);
        setActionError(errorTitle(error, "Could not upload the skill"));
      }
    },
    [isAdmin, isGlobal, uploadSkill]
  );

  const handleConfirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    const skill = pendingDelete;
    setPendingDelete(undefined);
    try {
      await deleteSkill(skill._id).unwrap();
    } catch (error) {
      console.warn("Failed to delete skill", error);
      setActionError(errorTitle(error, "Could not delete the skill"));
    }
  }, [deleteSkill, pendingDelete]);

  const handleDismissDelete = useCallback((): void => {
    setPendingDelete(undefined);
  }, []);

  const renderSkill = (skill: SkillRow): React.ReactElement => {
    const isGlobalSkill = skill.scope === "global";
    const isHidden = !isGlobalSkill && globalNames.has(skill.name);
    return (
      <Box
        border="default"
        direction="row"
        gap={2}
        key={skill._id}
        padding={3}
        rounding="md"
        testID={`skills-item-${skill.name}${isHidden ? "-hidden" : ""}`}
      >
        <Box flex="grow" gap={1}>
          <Box alignItems="center" direction="row" gap={2} wrap>
            <Text bold>{skill.name}</Text>
            {isGlobalSkill ? (
              <Box testID={`skills-global-badge-${skill.name}`}>
                <Badge status="info" value="For everyone" />
              </Box>
            ) : null}
          </Box>
          <Text color="secondaryLight" size="sm">
            {skill.description}
          </Text>
          {isHidden ? (
            <Text color="secondaryLight" size="sm" testID={`skills-hidden-note-${skill.name}`}>
              Hidden by a skill for everyone
            </Text>
          ) : null}
        </Box>
        {!isGlobalSkill || isAdmin ? (
          <IconButton
            accessibilityLabel={`Delete skill ${skill.name}`}
            iconName="trash"
            onClick={(): void => setPendingDelete(skill)}
            testID={`skills-delete-button-${skill.name}${isHidden ? "-hidden" : ""}`}
          />
        ) : null}
      </Box>
    );
  };

  return (
    <Page navigation={undefined} scroll>
      <Box gap={4} padding={4} testID="skills-screen">
        <Box alignItems="start">
          <Button
            iconName="arrow-left"
            onClick={handleBack}
            testID="skills-back-button"
            text="Back"
            variant="ghost"
          />
        </Box>
        <Heading size="lg">Skills</Heading>
        <Text color="secondaryLight">
          Skills teach the AI assistant how to do a task. Type /name at the start of a message to
          use one, or let the assistant pick it.
        </Text>

        <Box alignItems="center" direction="row" gap={2} wrap>
          <Button
            disabled={isFormOpen}
            iconName="plus"
            onClick={handleOpenForm}
            testID="skills-new-button"
            text="New skill"
          />
          <FilePickerButton
            disabled={isUploading}
            documentTypes={SKILL_DOCUMENT_TYPES}
            includeImages={false}
            onFilesSelected={(files): void => {
              void handleFilesSelected(files);
            }}
            testID="skills-upload-button"
            text="Upload skill"
          />
          {isUploading ? <Spinner size="sm" /> : null}
        </Box>
        {isAdmin ? (
          <Box alignItems="center" direction="row" gap={2}>
            <BooleanField
              onChange={setIsGlobal}
              testID="skills-form-global-switch"
              value={isGlobal}
            />
            <Text>Install for everyone</Text>
          </Box>
        ) : null}
        {actionError ? (
          <Text color="error" testID="skills-error">
            {actionError}
          </Text>
        ) : null}

        {isFormOpen ? (
          <Card>
            <Box gap={3}>
              <Heading size="md">New skill</Heading>
              <TextField
                helperText="Lowercase letters, digits, and hyphens"
                onChange={setName}
                testID="skills-form-name-input"
                title="Name"
                value={name}
              />
              <TextField
                onChange={setDescription}
                testID="skills-form-description-input"
                title="Description"
                value={description}
              />
              <TextField
                grow
                multiline
                onChange={setInstructions}
                rows={6}
                testID="skills-form-instructions-input"
                title="Instructions"
                value={instructions}
              />
              {formError ? (
                <Text color="error" testID="skills-form-error">
                  {formError}
                </Text>
              ) : null}
              <Box direction="row" gap={2}>
                <Button
                  loading={isCreating}
                  onClick={handleSave}
                  testID="skills-form-save-button"
                  text="Save"
                />
                <Button
                  onClick={handleCancelForm}
                  testID="skills-form-cancel-button"
                  text="Cancel"
                  variant="outline"
                />
              </Box>
            </Box>
          </Card>
        ) : null}

        {isLoading ? (
          <Spinner />
        ) : listError ? (
          <Text color="error" testID="skills-list-error">
            {errorTitle(listError, "Could not load skills")}
          </Text>
        ) : skills.length === 0 ? (
          <Text color="secondaryLight" testID="skills-empty">
            No skills yet.
          </Text>
        ) : (
          <Box gap={2} testID="skills-list">
            {skills.map(renderSkill)}
          </Box>
        )}
      </Box>
      <Modal
        onDismiss={handleDismissDelete}
        primaryButtonOnClick={handleConfirmDelete}
        primaryButtonText="Delete"
        secondaryButtonOnClick={handleDismissDelete}
        secondaryButtonText="Cancel"
        text={pendingDelete ? `Delete the skill ${pendingDelete.name}?` : undefined}
        title="Delete skill"
        visible={pendingDelete !== undefined}
      />
    </Page>
  );
};

export default SkillsScreen;
