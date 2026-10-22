import {type FC, useCallback, useMemo, useState} from "react";
import {View} from "react-native";

import {Box} from "../Box";
import {Button} from "../Button";
import {Card} from "../Card";
import {Heading} from "../Heading";
import {Icon} from "../Icon";
import {Modal} from "../Modal";
import {Text} from "../Text";
import {
  CREDENTIAL_PROVIDER_ID,
  formatSecurityDate,
  getProviderDisplay,
  getRejectionMessage,
  type ProviderDisplay,
} from "./securityMethods";
import type {LinkableProvider, LinkedAccount, LinkedAccountsCardProps} from "./securityTypes";

/** One row: a linked account, or an offered provider with no linked account. */
interface ProviderRow {
  /** React key: the account id, or the provider id for an unlinked row. */
  key: string;
  /** testID suffix: the provider id, plus `-2`, `-3`, ... for a provider's later accounts. */
  testIDSuffix: string;
  providerId: string;
  display: ProviderDisplay;
  account?: LinkedAccount;
}

/**
 * Builds one row per linked account (so two Google accounts are each unlinkable), grouped under
 * the offered providers in order, with a Link row for each offered provider that has none.
 * Accounts for providers the app no longer offers follow.
 */
const buildRows = ({
  accounts,
  providers,
}: {
  accounts: LinkedAccount[];
  providers: LinkableProvider[];
}): ProviderRow[] => {
  const socialAccounts = accounts.filter(
    (account) => account.providerId !== CREDENTIAL_PROVIDER_ID
  );
  const offeredIds = new Set(providers.map((provider) => provider.id));
  const accountRows = (providerId: string, display: ProviderDisplay): ProviderRow[] => {
    return socialAccounts
      .filter((account) => account.providerId === providerId)
      .map((account, index) => ({
        account,
        display,
        key: account.id,
        providerId,
        testIDSuffix: index === 0 ? providerId : `${providerId}-${index + 1}`,
      }));
  };

  const rows: ProviderRow[] = [];
  for (const provider of providers) {
    const display = getProviderDisplay({provider, providerId: provider.id});
    const linkedRows = accountRows(provider.id, display);
    if (linkedRows.length > 0) {
      rows.push(...linkedRows);
    } else {
      rows.push({display, key: provider.id, providerId: provider.id, testIDSuffix: provider.id});
    }
  }
  const extraProviderIds = [...new Set(socialAccounts.map((account) => account.providerId))].filter(
    (providerId) => !offeredIds.has(providerId)
  );
  for (const providerId of extraProviderIds) {
    rows.push(...accountRows(providerId, getProviderDisplay({providerId})));
  }
  return rows;
};

/** "ada@example.com · Linked Mar 3, 2026", or "Linked" when neither is known. */
const describeLinkedAccount = (account: LinkedAccount): string => {
  const linkedDate = formatSecurityDate(account.linkedAt);
  const parts = [account.email, linkedDate ? `Linked ${linkedDate}` : undefined].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" · ") : "Linked";
};

/**
 * Lists the sign-in providers an app offers, each linked (with its email and linked date) or not,
 * with Link and Unlink buttons. Unlink asks for confirmation, and is disabled with an explanation
 * when the account is the user's last way to sign in. Presentational: it reports actions through
 * `onLink` and `onUnlink` and never calls an auth client itself.
 *
 * @example
 * ```tsx
 * <LinkedAccountsCard
 *   accounts={accounts}               // listAccounts() entries as LinkedAccount ({id, providerId, linkedAt: createdAt})
 *   providers={[{id: "google"}, {id: "github"}]}
 *   otherMethodCount={passkeys.length}
 *   onLink={(providerId) => authClient.linkSocial({provider: providerId, callbackURL})}
 *   onUnlink={(_providerId, account) => authClient.unlinkAccount({accountId: account.id})}
 * />
 * ```
 */
export const LinkedAccountsCard: FC<LinkedAccountsCardProps> = ({
  accounts,
  providers,
  onLink,
  onUnlink,
  otherMethodCount = 0,
  canUnlinkLast = false,
  error,
  disabled = false,
  title = "Linked accounts",
  description = "Sign in with any account linked here.",
  testID = "linked-accounts-card",
}) => {
  const [pendingRowKey, setPendingRowKey] = useState<string | undefined>(undefined);
  const [confirmRow, setConfirmRow] = useState<ProviderRow | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const rows = useMemo(() => buildRows({accounts, providers}), [accounts, providers]);
  const isLastMethod = accounts.length + otherMethodCount <= 1;
  const isBusy = disabled || pendingRowKey !== undefined;
  const shownError = error ?? actionError;

  const runAction = useCallback(
    async ({
      rowKey,
      action,
      fallback,
    }: {
      rowKey: string;
      action: () => void | Promise<void>;
      fallback: string;
    }): Promise<void> => {
      setActionError(undefined);
      setPendingRowKey(rowKey);
      try {
        await action();
      } catch (rejection: unknown) {
        console.warn("LinkedAccountsCard: action rejected", rejection);
        setActionError(getRejectionMessage({error: rejection, fallback}));
      } finally {
        setPendingRowKey(undefined);
      }
    },
    []
  );

  const handleLink = useCallback(
    async (row: ProviderRow): Promise<void> => {
      if (!onLink || isBusy) {
        return;
      }
      await runAction({
        action: () => onLink(row.providerId),
        fallback: `Couldn't link ${row.display.label}. Try again.`,
        rowKey: row.key,
      });
    },
    [isBusy, onLink, runAction]
  );

  const handleDismissConfirm = useCallback((): void => {
    setConfirmRow(undefined);
  }, []);

  const handleConfirmUnlink = useCallback(async (): Promise<void> => {
    const row = confirmRow;
    setConfirmRow(undefined);
    if (!row?.account || !onUnlink) {
      return;
    }
    const account = row.account;
    await runAction({
      action: () => onUnlink(row.providerId, account),
      fallback: `Couldn't unlink ${row.display.label}. Try again.`,
      rowKey: row.key,
    });
  }, [confirmRow, onUnlink, runAction]);

  return (
    <Card testID={testID}>
      <Box gap={4}>
        <Box gap={1}>
          <Heading size="md" testID={`${testID}-title`}>
            {title}
          </Heading>
          <Text color="secondaryLight">{description}</Text>
        </Box>

        {rows.map((row) => {
          const {account, display, key, testIDSuffix} = row;
          const isPending = pendingRowKey === key;
          const isUnlinkBlocked = Boolean(account) && isLastMethod && !canUnlinkLast;
          return (
            <Box gap={1} key={key} testID={`${testID}-row-${testIDSuffix}`}>
              <Box alignItems="center" direction="row" gap={3}>
                <Box alignItems="center" width={24}>
                  <Icon iconName={display.iconName} size="lg" type={display.iconType} />
                </Box>
                <Box flex="grow" gap={1}>
                  <Text bold testID={`${testID}-name-${testIDSuffix}`}>
                    {display.label}
                  </Text>
                  <Text
                    color="secondaryLight"
                    size="sm"
                    testID={`${testID}-status-${testIDSuffix}`}
                  >
                    {account ? describeLinkedAccount(account) : "Not linked"}
                  </Text>
                </Box>
                {account && Boolean(onUnlink) && (
                  <Button
                    accessibilityLabel={
                      account.email
                        ? `Unlink ${display.label} (${account.email})`
                        : `Unlink ${display.label}`
                    }
                    disabled={isBusy || isUnlinkBlocked}
                    loading={isPending}
                    onClick={() => setConfirmRow(row)}
                    size="sm"
                    testID={`${testID}-unlink-${testIDSuffix}`}
                    text="Unlink"
                    variant="outline"
                  />
                )}
                {!account && Boolean(onLink) && (
                  <Button
                    accessibilityLabel={`Link ${display.label}`}
                    disabled={isBusy}
                    loading={isPending}
                    onClick={() => handleLink(row)}
                    size="sm"
                    testID={`${testID}-link-${testIDSuffix}`}
                    text="Link"
                    variant="secondary"
                  />
                )}
              </Box>
              {isUnlinkBlocked && Boolean(onUnlink) && (
                <Text
                  color="secondaryLight"
                  size="sm"
                  testID={`${testID}-last-method-${testIDSuffix}`}
                >
                  {`${display.label} is your only way to sign in. Add a password, a passkey, or another account before unlinking it.`}
                </Text>
              )}
            </Box>
          );
        })}

        {Boolean(shownError) && (
          <View role="alert" testID={`${testID}-error`}>
            <Text color="error">{shownError}</Text>
          </View>
        )}
      </Box>

      {confirmRow !== undefined && (
        <Modal
          onDismiss={handleDismissConfirm}
          primaryButtonOnClick={handleConfirmUnlink}
          primaryButtonText="Unlink"
          secondaryButtonOnClick={handleDismissConfirm}
          secondaryButtonText="Cancel"
          testIDs={{
            dismiss: `${testID}-confirm-dismiss`,
            primaryButton: `${testID}-confirm-submit`,
            root: `${testID}-confirm`,
            secondaryButton: `${testID}-confirm-cancel`,
            title: `${testID}-confirm-title`,
          }}
          text={`You won't be able to sign in with ${confirmRow.display.label}${
            confirmRow.account?.email ? ` (${confirmRow.account.email})` : ""
          } anymore. You can link it again later.`}
          title={`Unlink ${confirmRow.display.label}?`}
          visible
        />
      )}
    </Card>
  );
};
