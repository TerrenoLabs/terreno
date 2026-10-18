import {beforeEach, describe, expect, it, mock} from "bun:test";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminModelConfig} from "../types";

interface ActivityState {
  data: unknown;
  isError: boolean;
  isLoading: boolean;
}

const state: ActivityState = {data: undefined, isError: false, isLoading: false};
const listCalls: unknown[] = [];

mock.module("../useAdminModelApi", () => ({
  useAdminModelApi: () => ({
    useListQuery: (...args: unknown[]) => {
      listCalls.push(args);
      return state;
    },
  }),
}));

import {RecentActivityWidget} from "../widgets/RecentActivityWidget";

const auditModel: AdminModelConfig = {
  displayName: "Audit logs",
  fields: {},
  name: "AdminAuditLog",
  routePath: "/admin/audit-logs",
};
const orgScopedAuditModel: AdminModelConfig = {
  ...auditModel,
  organizationScoped: true,
};
const baseProps = {
  apiBase: "/admin",
  routeBase: "/admin",
};

describe("RecentActivityWidget", () => {
  beforeEach(() => {
    state.data = undefined;
    state.isError = false;
    state.isLoading = false;
    listCalls.length = 0;
  });

  it("explains how to enable activity when no audit model is registered", () => {
    const {getByText} = renderWithTheme(
      <RecentActivityWidget {...baseProps} config={{models: [], scripts: []}} models={[]} />
    );
    expect(getByText(/Register AuditApp \(or an AdminAuditLog model\)/)).toBeDefined();
    expect(listCalls[0]).toEqual([{limit: 8, page: 1, sort: "-created"}, {skip: true}]);
  });

  it("skips org-scoped list queries until organization context is available", () => {
    renderWithTheme(
      <RecentActivityWidget
        {...baseProps}
        auditModel={orgScopedAuditModel}
        config={{models: [orgScopedAuditModel], scripts: []}}
        models={[orgScopedAuditModel]}
      />
    );
    expect(listCalls[0]).toEqual([{limit: 8, page: 1, sort: "-created"}, {skip: true}]);
  });

  it("renders loading, error, and empty states", () => {
    state.isLoading = true;
    let rendered = renderWithTheme(
      <RecentActivityWidget
        {...baseProps}
        auditModel={auditModel}
        config={{models: [auditModel], scripts: []}}
        models={[auditModel]}
      />
    );
    expect(rendered.toJSON()).toBeDefined();
    rendered.unmount();

    state.isLoading = false;
    state.isError = true;
    rendered = renderWithTheme(
      <RecentActivityWidget
        {...baseProps}
        auditModel={auditModel}
        config={{models: [auditModel], scripts: []}}
        models={[auditModel]}
      />
    );
    expect(rendered.getByText("Could not load audit entries.")).toBeDefined();
    rendered.unmount();

    state.isError = false;
    rendered = renderWithTheme(
      <RecentActivityWidget
        {...baseProps}
        auditModel={auditModel}
        config={{models: [auditModel], scripts: []}}
        models={[auditModel]}
      />
    );
    expect(rendered.getByText("No audit entries yet.")).toBeDefined();
  });

  it("renders populated audit rows with label and date fallbacks", () => {
    state.data = {
      data: [
        {
          _id: "audit-1",
          createdAt: "2026-09-01T10:00:00.000Z",
          modelName: "Todo",
          recordLabel: "Ship coverage",
          verb: "updated",
        },
        {
          created: 42,
          id: "audit-2",
          modelName: "Todo",
          recordId: "todo-2",
          verb: "deleted",
        },
      ],
    };
    const {getByText} = renderWithTheme(
      <RecentActivityWidget
        {...baseProps}
        auditModel={auditModel}
        config={{models: [auditModel], scripts: []}}
        models={[auditModel]}
      />
    );
    expect(getByText(/Ship coverage/)).toBeDefined();
    expect(getByText(/todo-2/)).toBeDefined();
  });
});
