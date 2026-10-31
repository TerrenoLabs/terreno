import {Box, Card, Heading, printDateAndTime, Spinner, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {shouldSkipOrgScopedAdminQuery} from "../orgs/shouldSkipOrgScopedAdminQuery";
import {useOptionalOrgContext} from "../orgs/useOrgContext";
import type {AdminFieldValue, AdminHomeWidgetProps} from "../types";
import {useAdminModelApi} from "../useAdminModelApi";

export const RecentActivityWidget: React.FC<AdminHomeWidgetProps> = ({auditModel}) => {
  const organizationId = useOptionalOrgContext()?.organizationId;
  const skipOrgScopedQuery = shouldSkipOrgScopedAdminQuery({
    organizationId,
    organizationScoped: auditModel?.organizationScoped,
  });
  const {useListQuery} = useAdminModelApi(auditModel?.routePath ?? "", auditModel?.name ?? "");
  const {data, isLoading, isError} = useListQuery(
    {limit: 8, page: 1, sort: auditModel?.defaultSort ?? "-created"},
    {skip: !auditModel?.routePath || skipOrgScopedQuery}
  );

  const rows = useMemo((): Record<string, AdminFieldValue>[] => {
    const body = data as {data?: Record<string, AdminFieldValue>[]} | undefined;
    return Array.isArray(body?.data) ? body.data : [];
  }, [data]);

  if (!auditModel) {
    return (
      <Card padding={4} testID="admin-home-widget-recentActivity">
        <Heading size="sm">Recent activity</Heading>
        <Box marginTop={2}>
          <Text color="secondaryDark" size="sm">
            Register AuditApp (or an AdminAuditLog model) to show recent mutations here.
          </Text>
        </Box>
      </Card>
    );
  }

  return (
    <Card padding={4} testID="admin-home-widget-recentActivity">
      <Heading size="sm">Recent activity</Heading>
      {isLoading ? (
        <Box alignItems="center" marginTop={3} padding={2}>
          <Spinner />
        </Box>
      ) : null}
      {isError ? (
        <Box marginTop={2}>
          <Text color="error" size="sm">
            Could not load audit entries.
          </Text>
        </Box>
      ) : null}
      {!isLoading && !isError && rows.length === 0 ? (
        <Box marginTop={2}>
          <Text color="secondaryDark" size="sm">
            No audit entries yet.
          </Text>
        </Box>
      ) : null}
      {!isLoading && !isError && rows.length > 0 ? (
        <Box gap={2} marginTop={2}>
          {rows.map((row) => {
            const id = String(row._id ?? row.id ?? "");
            const verb = String(row.verb ?? "");
            const modelName = String(row.modelName ?? "");
            const label = String(row.recordLabel ?? row.recordId ?? "");
            const created = row.createdAt ?? row.created;
            const when =
              typeof created === "string" ? printDateAndTime(created, {defaultValue: created}) : "";
            return (
              <Box border="default" key={id || `${verb}-${label}`} padding={2} rounding="sm">
                <Text size="sm">
                  <Text bold>{verb}</Text> {modelName}
                  {label ? ` — ${label}` : ""}
                </Text>
                {when ? (
                  <Text color="secondaryDark" size="sm">
                    {when}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Card>
  );
};
