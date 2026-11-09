import {Box, Heading, Link, Text} from "@terreno/ui";
import React from "react";

const DOC_LINK =
  "https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/admin-ui-v2-django-parity.md";

/**
 * Static map of admin UI v2 features demonstrated by example-backend AdminApp and this admin
 * shell.
 */
const AdminUiV2ShowcaseScreen: React.FC = () => {
  return (
    <Box direction="column" gap={3} padding={4} testID="admin-showcase-root">
      <Heading size="lg">Admin UI v2 in this example</Heading>
      <Text color="secondaryDark" size="sm">
        The example backend registers AdminApp with models, scripts, audit logging, and a home
        dashboard. Use this page as a checklist while you click through the admin.
      </Text>
      <Heading size="md">Home dashboard</Heading>
      <Text size="sm">
        From Profile → Admin: per-model counts, model grid with add (+) shortcuts, feature flags and
        scripts on one top row, version config, and recent audit activity — wired via home.slots in
        example-backend/src/server.ts (navGlobal + contentTop render together).
      </Text>
      <Heading size="md">Sidebar</Heading>
      <Text size="sm">
        Admin shell lists Tools (each registered script plus version), then Models (grouped by
        AdminModelConfig.group from the server), then custom Screens.
      </Text>
      <Heading size="md">Models and changelist</Heading>
      <Box direction="column" gap={2}>
        <Text size="sm">
          • Feature Flags — boolean and choice filters, extended columns, text search, grouping.
        </Text>
        <Text size="sm">
          • Todos — form fieldsets, read-only ownerId, title as row link, boolean/choice/date-range
          and ref filters, bulk “Mark completed” row action, realtime hint, bulk-patch allowlist,
          deletes disabled.
        </Text>
        <Text size="sm">
          • Users — profile/access fieldsets, email read-only on edit, admin filter.
        </Text>
        <Text size="sm">
          {`• Todos & Users share one sidebar group label ("Demo: shared app data") so multiple models appear under a single custom heading.`}
        </Text>
        <Text size="sm">
          • Consent forms — locale and checkbox-list widgets, fieldsets, list display, filters.
        </Text>
        <Text size="sm">• Consent responses — filters; delete disabled in admin config.</Text>
        <Text size="sm">
          • Audit log — read-only model populated by onAdminAudit after mutations.
        </Text>
      </Box>
      <Heading size="md">Also try</Heading>
      <Text size="sm">
        Maintenance scripts (dry and wet runs), application configuration, document storage on the
        Files tab, and the AI Admin custom screen.
      </Text>
      <Link href={DOC_LINK} size="sm" text="Django-parity implementation plan (repo doc)" />
    </Box>
  );
};

export default AdminUiV2ShowcaseScreen;
