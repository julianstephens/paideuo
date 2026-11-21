import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "../auth/session";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { type ServiceCredentialScope, serviceCredentialsApi } from "./serviceCredentials";

const columnLayout = { base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" };

const defaultServiceScopes: ServiceCredentialScope[] = [
  "imports:commit",
  "programs:read",
  "programs:write",
  "workouts:write",
  "metrics:write",
  "recordings:write",
];

export const SettingsPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <CredentialSettings key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const CredentialSettings = ({ ownerId }: { ownerId: string }) => {
  const [saving, setSaving] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [issueLabel, setIssueLabel] = useState("");
  const [issueExpiresAt, setIssueExpiresAt] = useState("");
  const [issueScopes, setIssueScopes] = useState<ServiceCredentialScope[]>(["imports:commit"]);
  const [issueAllowHistoryRewrite, setIssueAllowHistoryRewrite] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["service-credentials", ownerId],
    queryFn: ({ signal }) => serviceCredentialsApi.list(signal),
    retry: false,
  });
  const credentials = list.data?.credentials ?? [];
  const availableScopes = list.data?.availableScopes ?? defaultServiceScopes;
  const credentialsBusy = saving || list.isFetching;
  const listError = list.error
    ? errorMessage(list.error, "Unable to load service credentials.")
    : null;

  const issueDisabled =
    credentialsBusy ||
    !issueLabel.trim() ||
    issueScopes.length === 0 ||
    !issueScopes.includes("imports:commit");

  const issueCredential = async () => {
    if (issueDisabled) return;
    setSaving(true);
    setCredentialsError(null);
    setIssuedToken(null);
    try {
      const result = await serviceCredentialsApi.issue({
        label: issueLabel.trim(),
        scopes: issueScopes,
        expiresAt: issueExpiresAt || null,
        allowHistoryRewrite: issueAllowHistoryRewrite,
      });
      setIssuedToken(result.plaintextToken);
      setIssueLabel("");
      setIssueExpiresAt("");
      setIssueScopes(["imports:commit"]);
      setIssueAllowHistoryRewrite(false);
      await list.refetch();
    } catch (error) {
      setCredentialsError(errorMessage(error, "Unable to issue credential."));
    } finally {
      setSaving(false);
    }
  };

  const revokeCredential = async (id: string) => {
    setSaving(true);
    setCredentialsError(null);
    try {
      await serviceCredentialsApi.revoke(id);
      await list.refetch();
    } catch (error) {
      setCredentialsError(errorMessage(error, "Unable to revoke credential."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="6">
      <PageHeader title="Settings" />
      <Panel as="section" gap="4">
        <Stack gap="1">
          <Heading as="h2" size="md">
            Service credentials
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            Issue owner-scoped tokens for scripts and agents. Plaintext tokens are shown once.
          </Text>
        </Stack>
        <Grid templateColumns={columnLayout} gap="3">
          <FormField>
            Label
            <Input
              value={issueLabel}
              maxLength={200}
              disabled={credentialsBusy}
              placeholder="Agent label"
              onChange={(event) => setIssueLabel(event.target.value)}
            />
          </FormField>
          <FormField>
            Expiry (optional)
            <Input
              type="datetime-local"
              value={issueExpiresAt}
              disabled={credentialsBusy}
              onChange={(event) => setIssueExpiresAt(event.target.value)}
            />
          </FormField>
        </Grid>
        <Stack gap="2">
          <Flex align="center" gap="2" wrap="wrap">
            <Text fontSize="sm" color="fg.muted">
              Scopes
            </Text>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Select all credential scopes"
              disabled={
                credentialsBusy || availableScopes.every((scope) => issueScopes.includes(scope))
              }
              onClick={() => setIssueScopes([...availableScopes])}
            >
              Select all
            </Button>
          </Flex>
          <Grid templateColumns={columnLayout} gap="2">
            {availableScopes.map((scope) => (
              <Checkbox.Root
                key={scope}
                checked={issueScopes.includes(scope)}
                disabled={credentialsBusy}
                onCheckedChange={({ checked }) =>
                  setIssueScopes((current) =>
                    checked === true
                      ? [...new Set([...current, scope])]
                      : current.filter((item) => item !== scope),
                  )
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label fontSize="sm">{scope}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </Grid>
          <Checkbox.Root
            checked={issueAllowHistoryRewrite}
            disabled={credentialsBusy}
            onCheckedChange={({ checked }) => setIssueAllowHistoryRewrite(checked === true)}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label fontSize="sm">
              Allow completed workout history rewrite (destructive)
            </Checkbox.Label>
          </Checkbox.Root>
        </Stack>
        {(credentialsError || listError) && (
          <Notice role="alert">{credentialsError || listError}</Notice>
        )}
        {issuedToken && (
          <Stack gap="2" bg="bg.inset" borderRadius="md" p="3">
            <Text fontSize="sm" role="status">
              Copy this token now. It’s shown only once.
            </Text>
            <FormField>
              Service token
              <Input value={issuedToken} readOnly fontFamily="mono" />
            </FormField>
          </Stack>
        )}
        <Flex gap="3" wrap="wrap">
          <Button
            colorPalette="teal"
            onClick={() => void issueCredential()}
            disabled={issueDisabled}
          >
            Issue credential
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setCredentialsError(null);
              void list.refetch();
            }}
            disabled={credentialsBusy}
          >
            Refresh list
          </Button>
        </Flex>
        {list.isPending && <Notice role="status">Loading service credentials…</Notice>}
        {list.isSuccess && !credentials.length && <Notice>No service credentials yet.</Notice>}
        {credentials.length > 0 && (
          <Box overflowX="auto">
            <Table.Root size="sm" variant="outline" aria-label="Service credentials">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Label</Table.ColumnHeader>
                  <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                  <Table.ColumnHeader>Scopes</Table.ColumnHeader>
                  <Table.ColumnHeader>Expiry</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {credentials.map((credential) => {
                  const revoked = Boolean(credential.revokedAt);
                  return (
                    <Table.Row key={credential.id}>
                      <Table.Cell>{credential.label}</Table.Cell>
                      <Table.Cell>{credential.tokenPrefix}</Table.Cell>
                      <Table.Cell>{credential.scopes.join(", ")}</Table.Cell>
                      <Table.Cell>{credential.expiresAt || "Never"}</Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette={revoked ? "red" : "green"}>
                          {revoked ? "Revoked" : "Active"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={credentialsBusy || revoked}
                          onClick={() => void revokeCredential(credential.id)}
                        >
                          Revoke
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </Panel>
    </Stack>
  );
};
