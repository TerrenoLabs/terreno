import {
  Banner,
  Box,
  Button,
  Card,
  DateTimeField,
  Heading,
  Modal,
  Page,
  Spinner,
  Text,
  TextField,
  useToast,
} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {
  buildMcpClientSnippet,
  copyMcpText,
  formatMcpTimestamp,
  issuedTokenFromCreateResult,
} from "@/lib/mcpSettingsHelpers";
import {
  useCreateMcpServiceTokenMutation,
  useListMcpServiceTokensQuery,
  useRevokeMcpServiceTokenMutation,
} from "@/store/apiSdk";

interface McpServiceTokenListItem {
  created?: string;
  expiresAt?: string | null;
  id?: string;
  lastUsedAt?: string | null;
  name?: string;
  revokedAt?: string | null;
  tokenPrefix?: string;
}

interface IssuedMcpServiceToken {
  mcpUrl: string;
  token: string;
}

const McpSettingsScreen: React.FC = () => {
  const router = useRouter();
  const toast = useToast();
  const {data: listResponse, isLoading, error: listError} = useListMcpServiceTokensQuery({});
  const [createToken, {isLoading: isCreating}] = useCreateMcpServiceTokenMutation();
  const [revokeToken, {isLoading: isRevoking}] = useRevokeMcpServiceTokenMutation();

  const [name, setName] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedMcpServiceToken | null>(null);

  const tokens = useMemo((): McpServiceTokenListItem[] => {
    const rows = listResponse?.data;
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows as McpServiceTokenListItem[];
  }, [listResponse?.data]);

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const handleCopy = useCallback(
    async (value: string, label: string): Promise<void> => {
      try {
        await copyMcpText(value);
        toast.success(`${label} copied`);
      } catch {
        toast.error(`Could not copy ${label}`);
      }
    },
    [toast]
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Name is required");
      return;
    }
    setCreateError(null);
    try {
      const result = (await createToken({
        ...(expiresAt ? {expiresAt} : {}),
        name: trimmedName,
      }).unwrap()) as {
        data?: {mcpUrl?: string; token?: string};
        mcpUrl?: string;
        token?: string;
      };
      const issuedToken = issuedTokenFromCreateResult(result);
      if (!issuedToken) {
        setCreateError("Create succeeded but the token was not returned");
        return;
      }
      setIssued(issuedToken);
      setName("");
      setExpiresAt("");
    } catch (error: unknown) {
      const title =
        error && typeof error === "object" && "data" in error
          ? String((error as {data?: {title?: string}}).data?.title ?? "Could not create token")
          : "Could not create token";
      setCreateError(title);
    }
  }, [createToken, expiresAt, name]);

  const handleDismissIssued = useCallback((): void => {
    setIssued(null);
  }, []);

  const handleRevoke = useCallback(
    async (id?: string): Promise<void> => {
      if (!id) {
        return;
      }
      try {
        await revokeToken(id).unwrap();
        toast.success("Token revoked");
      } catch {
        toast.error("Could not revoke token");
      }
    },
    [revokeToken, toast]
  );

  const issuedSnippet = issued ? buildMcpClientSnippet(issued.mcpUrl, issued.token) : "";

  return (
    <Page backButton onBack={handleBack} scroll title="MCP connections">
      <Box gap={4} padding={4}>
        <Text color="secondaryLight">
          Mint a personal key for Perplexity and other remote MCP clients. The secret is shown once.
        </Text>

        <Card>
          <Box gap={4}>
            <Heading size="md">Create token</Heading>
            <TextField
              helperText="A label you will recognize later"
              onChange={setName}
              placeholder="Perplexity laptop"
              testID="settings-mcp-name"
              title="Name"
              value={name}
            />
            <DateTimeField
              helperText="Optional. Leave empty for no expiry."
              onChange={setExpiresAt}
              testID="settings-mcp-expires"
              title="Expires"
              type="datetime"
              value={expiresAt || undefined}
            />
            {createError ? <Banner status="alert" text={createError} /> : null}
            <Button
              loading={isCreating}
              onClick={handleCreate}
              testID="settings-mcp-create"
              text="Create token"
              variant="primary"
            />
          </Box>
        </Card>

        <Card>
          <Box gap={4}>
            <Heading size="md">Your tokens</Heading>
            {isLoading ? (
              <Box alignItems="center" padding={4}>
                <Spinner />
              </Box>
            ) : null}
            {listError ? <Banner status="alert" text="Could not load tokens" /> : null}
            {!isLoading && tokens.length === 0 ? (
              <Text color="secondaryLight" testID="settings-mcp-empty">
                No tokens yet.
              </Text>
            ) : null}
            {tokens.map((token) => {
              const isRevoked = Boolean(token.revokedAt);
              return (
                <Card key={token.id ?? token.tokenPrefix}>
                  <Box gap={2} testID={`settings-mcp-row-${token.tokenPrefix ?? "unknown"}`}>
                    <Text bold>
                      {token.name ?? "Unnamed"} {isRevoked ? "(revoked)" : ""}
                    </Text>
                    <Text color="secondaryLight" size="sm">
                      Prefix mcp_{token.tokenPrefix} · created {formatMcpTimestamp(token.created)}
                    </Text>
                    <Text color="secondaryLight" size="sm">
                      Last used {formatMcpTimestamp(token.lastUsedAt)} · expires{" "}
                      {formatMcpTimestamp(token.expiresAt)}
                    </Text>
                    {!isRevoked ? (
                      <Button
                        confirmationText="Revoke this token? MCP clients using it will stop working."
                        loading={isRevoking}
                        onClick={() => {
                          void handleRevoke(token.id);
                        }}
                        testID={`settings-mcp-revoke-${token.tokenPrefix ?? "unknown"}`}
                        text="Revoke"
                        variant="destructive"
                        withConfirmation
                      />
                    ) : null}
                  </Box>
                </Card>
              );
            })}
          </Box>
        </Card>
      </Box>

      <Modal
        onDismiss={handleDismissIssued}
        persistOnBackgroundClick
        primaryButtonOnClick={handleDismissIssued}
        primaryButtonText="Done"
        size="md"
        title="Copy this token now"
        visible={Boolean(issued)}
      >
        {issued ? (
          <Box gap={3}>
            <Banner
              status="warning"
              text="This secret is shown once. Store it in your MCP client."
            />
            <Text bold>MCP URL</Text>
            <Text testID="settings-mcp-issued-url">{issued.mcpUrl}</Text>
            <Button
              onClick={() => {
                void handleCopy(issued.mcpUrl, "URL");
              }}
              testID="settings-mcp-copy-url"
              text="Copy URL"
              variant="secondary"
            />
            <Text bold>API key</Text>
            <Text testID="settings-mcp-issued-token">{issued.token}</Text>
            <Button
              onClick={() => {
                void handleCopy(issued.token, "token");
              }}
              testID="settings-mcp-copy-token"
              text="Copy token"
              variant="secondary"
            />
            <Text bold>Client JSON</Text>
            <Text testID="settings-mcp-issued-json">{issuedSnippet}</Text>
            <Button
              onClick={() => {
                void handleCopy(issuedSnippet, "JSON");
              }}
              testID="settings-mcp-copy-json"
              text="Copy JSON"
              variant="secondary"
            />
          </Box>
        ) : null}
      </Modal>
    </Page>
  );
};

export default McpSettingsScreen;
