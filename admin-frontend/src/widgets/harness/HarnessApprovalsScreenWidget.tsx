import React, {useCallback, useState} from "react";
import {AdminScreenPage} from "../../AdminScreenPage";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "../../types";
import {HarnessApprovalInbox} from "./HarnessApprovalInbox";
import type {HarnessApprovalRow} from "./harnessApprovalTypes";

/** Admin custom screen `harness-approvals` (group "AI Harness") contributed by `HarnessApp`. */
export const HarnessApprovalsScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  const [selected, setSelected] = useState<HarnessApprovalRow | undefined>();
  // With an approval open, the page's back control returns to the list, not admin home.
  const closeDetail = useCallback((): void => {
    setSelected(undefined);
  }, []);

  return (
    <AdminScreenPage
      backHref={routeBase || "/admin"}
      color="transparent"
      maxWidth="100%"
      onBack={selected ? closeDetail : undefined}
      padding={4}
      title="Approvals"
    >
      <HarnessApprovalInbox
        onSelectedChange={setSelected}
        selected={selected}
        showHeading={false}
      />
    </AdminScreenPage>
  );
};

export const HARNESS_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  "harness-approvals": HarnessApprovalsScreenWidget,
};
