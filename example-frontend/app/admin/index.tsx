import {AdminHome} from "@terreno/admin-frontend";
import {Box, Page} from "@terreno/ui";
import type React from "react";
import {AdminCharts} from "@/components/AdminCharts";
import {ADMIN_ROUTE} from "@/constants/adminConstants";
import {terrenoApi} from "@/store/sdk";

const AdminListScreen: React.FC = () => {
  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll title="Admin">
      <Box gap={6} width="100%">
        <AdminHome api={terrenoApi} baseUrl={ADMIN_ROUTE} embedded />
        <AdminCharts />
      </Box>
    </Page>
  );
};

export default AdminListScreen;
