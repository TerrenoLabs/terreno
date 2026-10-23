import {type FC, useCallback, useState} from "react";
import {View} from "react-native";

import {Badge} from "../Badge";
import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Modal} from "../Modal";
import {Text} from "../Text";
import {TextField} from "../TextField";
import {formatSecurityDate, getRejectionMessage} from "./securityMethods";
import type {AccountPasskey, PasskeysCardProps} from "./securityTypes";

/** Pending key for the Add button; rows use `rename:{id}` and `remove:{id}`. */
const ADD_KEY = "__add__";

/** The dialog the card has open: naming a new passkey, renaming one, or confirming removal. */
type PasskeyDialog =
  | {kind: "add"}
  | {kind: "rename"; passkey: AccountPasskey}
  | {kind: "remove"; passkey: AccountPasskey};

/** The passkey's name, else its authenticator's name, else "Unnamed passkey". */
const getPasskeyLabel = (passkey: AccountPasskey): string => {
  return passkey.name?.trim() || passkey.authenticatorName?.trim() || "Unnamed passkey";
};

/** "Added Mar 3, 2026 · Last used Mar 10, 2026", or "Passkey" when neither date is known. */
const describePasskey = (passkey: AccountPasskey): string => {
  const createdDate = formatSecurityDate(passkey.createdAt);
  const lastUsedDate = formatSecurityDate(passkey.lastUsedAt);
  const parts = [
    createdDate ? `Added ${createdDate}` : undefined,
    lastUsedDate ? `Last used ${lastUsedDate}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : "Passkey";
};

/**
 * Lists the user's passkeys with their created and last-used dates and a "Synced" badge for
 * backed-up ones, and lets the user add, rename, and remove them. Add asks for an optional name,
 * Rename edits the name in a dialog, and Remove asks for confirmation. When the device can't
 * create passkeys (`supported={false}`) Add is hidden and the card says why. Presentational: it
 * reports actions through `onAdd`, `onRename`, and `onRemove` and never calls an auth client.
 *
 * @example
 * ```tsx
 * // The Better Auth client resolves {data, error} rather than throwing; throw so the card
 * // shows the error.
 * <PasskeysCard
 *   passkeys={passkeys}                   // authClient.passkey.listUserPasskeys() data
 *   supported={typeof window !== "undefined" && "PublicKeyCredential" in window}
 *   onAdd={async (name) => {
 *     const {error} = await authClient.passkey.addPasskey({name});
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't add a passkey.");
 *     }
 *   }}
 *   onRename={async (id, name) => {
 *     const {error} = await authClient.passkey.updatePasskey({id, name});
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't rename that passkey.");
 *     }
 *   }}
 *   onRemove={async (passkey) => {
 *     const {error} = await authClient.passkey.deletePasskey({id: passkey.id});
 *     if (error) {
 *       throw new Error(error.message ?? "Couldn't remove that passkey.");
 *     }
 *   }}
 * />
 * ```
 */
export const PasskeysCard: FC<PasskeysCardProps> = ({
  passkeys,
  onAdd,
  onRename,
  onRemove,
  supported = true,
  error,
  disabled = false,
  title = "Passkeys",
  description = "Sign in with your fingerprint, face, or screen lock instead of a password.",
  testID = "passkeys-card",
}) => {
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined);
  const [dialog, setDialog] = useState<PasskeyDialog | undefined>(undefined);
  const [nameDraft, setNameDraft] = useState("");
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const isBusy = disabled || pendingKey !== undefined;
  const shownError = error ?? actionError;
  const trimmedDraft = nameDraft.trim();
  const isRenameUnchanged =
    dialog?.kind === "rename" && trimmedDraft === (dialog.passkey.name?.trim() ?? "");

  const runAction = useCallback(
    async ({
      key,
      action,
      fallback,
    }: {
      key: string;
      action: () => void | Promise<void>;
      fallback: string;
    }): Promise<void> => {
      setActionError(undefined);
      setPendingKey(key);
      try {
        await action();
      } catch (rejection: unknown) {
        console.warn("PasskeysCard: action rejected", rejection);
        setActionError(getRejectionMessage({error: rejection, fallback}));
      } finally {
        setPendingKey(undefined);
      }
    },
    []
  );

  const handleDismissDialog = useCallback((): void => {
    setDialog(undefined);
  }, []);

  const handleOpenAdd = useCallback((): void => {
    setNameDraft("");
    setDialog({kind: "add"});
  }, []);

  const handleOpenRename = useCallback((passkey: AccountPasskey): void => {
    setNameDraft(passkey.name ?? "");
    setDialog({kind: "rename", passkey});
  }, []);

  const handleOpenRemove = useCallback((passkey: AccountPasskey): void => {
    setDialog({kind: "remove", passkey});
  }, []);

  const handleConfirmAdd = useCallback(async (): Promise<void> => {
    setDialog(undefined);
    if (!onAdd) {
      return;
    }
    const name = trimmedDraft || undefined;
    await runAction({
      action: () => onAdd(name),
      fallback: "Couldn't add a passkey. Try again.",
      key: ADD_KEY,
    });
  }, [onAdd, runAction, trimmedDraft]);

  const handleConfirmRename = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== "rename" || !trimmedDraft || isRenameUnchanged) {
      return;
    }
    const {passkey} = dialog;
    setDialog(undefined);
    if (!onRename) {
      return;
    }
    await runAction({
      action: () => onRename(passkey.id, trimmedDraft),
      fallback: `Couldn't rename ${getPasskeyLabel(passkey)}. Try again.`,
      key: `rename:${passkey.id}`,
    });
  }, [dialog, isRenameUnchanged, onRename, runAction, trimmedDraft]);

  const handleConfirmRemove = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== "remove") {
      return;
    }
    const {passkey} = dialog;
    setDialog(undefined);
    if (!onRemove) {
      return;
    }
    await runAction({
      action: () => onRemove(passkey),
      fallback: `Couldn't remove ${getPasskeyLabel(passkey)}. Try again.`,
      key: `remove:${passkey.id}`,
    });
  }, [dialog, onRemove, runAction]);

  return (
    <Card testID={testID}>
      <Box gap={4}>
        <Box gap={1}>
          <Heading size="md" testID={`${testID}-title`}>
            {title}
          </Heading>
          <Text color="secondaryLight">{description}</Text>
        </Box>

        {passkeys.length === 0 && (
          <Text color="secondaryLight" testID={`${testID}-empty`}>
            You haven't added a passkey yet.
          </Text>
        )}

        {passkeys.map((passkey) => {
          const {id} = passkey;
          const label = getPasskeyLabel(passkey);
          return (
            <Box
              alignItems="center"
              direction="row"
              gap={3}
              key={id}
              testID={`${testID}-row-${id}`}
            >
              <Box alignItems="center" width={24}>
                <Icon iconName="key" size="lg" />
              </Box>
              <Box flex="grow" gap={1}>
                <Box alignItems="center" direction="row" gap={2} wrap>
                  <Text bold testID={`${testID}-name-${id}`}>
                    {label}
                  </Text>
                  {Boolean(passkey.backedUp) && (
                    <Badge
                      iconName="cloud"
                      secondary
                      status="info"
                      testID={`${testID}-synced-${id}`}
                      value="Synced"
                    />
                  )}
                </Box>
                <Text color="secondaryLight" size="sm" testID={`${testID}-status-${id}`}>
                  {describePasskey(passkey)}
                </Text>
              </Box>
              {Boolean(onRename) && (
                <Button
                  accessibilityLabel={`Rename passkey ${label}`}
                  disabled={isBusy}
                  loading={pendingKey === `rename:${id}`}
                  onClick={() => handleOpenRename(passkey)}
                  size="sm"
                  testID={`${testID}-rename-${id}`}
                  text="Rename"
                  variant="muted"
                />
              )}
              {Boolean(onRemove) && (
                <Button
                  accessibilityLabel={`Remove passkey ${label}`}
                  disabled={isBusy}
                  loading={pendingKey === `remove:${id}`}
                  onClick={() => handleOpenRemove(passkey)}
                  size="sm"
                  testID={`${testID}-remove-${id}`}
                  text="Remove"
                  variant="outline"
                />
              )}
            </Box>
          );
        })}

        {!supported && (
          <Text color="secondaryLight" testID={`${testID}-unsupported`}>
            This device or browser can't create passkeys. You can add one from another device, and
            manage the ones you have here.
          </Text>
        )}

        {Boolean(shownError) && (
          <View role="alert" testID={`${testID}-error`}>
            <Text color="error">{shownError}</Text>
          </View>
        )}

        {supported && Boolean(onAdd) && (
          <Box alignItems="start">
            <Button
              disabled={isBusy}
              iconName="plus"
              loading={pendingKey === ADD_KEY}
              onClick={handleOpenAdd}
              testID={`${testID}-add`}
              text="Add a passkey"
              variant="secondary"
            />
          </Box>
        )}
      </Box>

      {dialog?.kind === "add" && (
        <Modal
          onDismiss={handleDismissDialog}
          primaryButtonOnClick={handleConfirmAdd}
          primaryButtonText="Continue"
          secondaryButtonOnClick={handleDismissDialog}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-add-dialog-dismiss`,
            primaryButton: `${testID}-add-dialog-submit`,
            root: `${testID}-add-dialog`,
            secondaryButton: `${testID}-add-dialog-cancel`,
            title: `${testID}-add-dialog-title`,
          }}
          text="Your device will ask you to confirm with your fingerprint, face, or screen lock."
          title="Add a passkey"
          visible
        >
          <TextField
            accessibilityLabel="Passkey name"
            helperText="Optional. For example, “Work laptop”."
            onChange={setNameDraft}
            onEnter={handleConfirmAdd}
            testID={`${testID}-add-dialog-name`}
            title="Name"
            value={nameDraft}
          />
        </Modal>
      )}

      {dialog?.kind === "rename" && (
        <Modal
          onDismiss={handleDismissDialog}
          primaryButtonDisabled={!trimmedDraft || isRenameUnchanged}
          primaryButtonOnClick={handleConfirmRename}
          primaryButtonText="Save"
          secondaryButtonOnClick={handleDismissDialog}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-rename-dialog-dismiss`,
            primaryButton: `${testID}-rename-dialog-submit`,
            root: `${testID}-rename-dialog`,
            secondaryButton: `${testID}-rename-dialog-cancel`,
            title: `${testID}-rename-dialog-title`,
          }}
          title={`Rename ${getPasskeyLabel(dialog.passkey)}`}
          visible
        >
          <TextField
            accessibilityLabel="Passkey name"
            onChange={setNameDraft}
            onEnter={handleConfirmRename}
            testID={`${testID}-rename-dialog-name`}
            title="Name"
            value={nameDraft}
          />
        </Modal>
      )}

      {dialog?.kind === "remove" && (
        <Modal
          onDismiss={handleDismissDialog}
          primaryButtonOnClick={handleConfirmRemove}
          primaryButtonText="Remove"
          secondaryButtonOnClick={handleDismissDialog}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-confirm-dismiss`,
            primaryButton: `${testID}-confirm-submit`,
            root: `${testID}-confirm`,
            secondaryButton: `${testID}-confirm-cancel`,
            title: `${testID}-confirm-title`,
          }}
          text="You won't be able to sign in with this passkey anymore. Also remove it from your device or password manager."
          title={`Remove ${getPasskeyLabel(dialog.passkey)}?`}
          visible
        />
      )}
    </Card>
  );
};
