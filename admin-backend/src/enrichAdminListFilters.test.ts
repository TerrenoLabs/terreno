import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";
import type {AdminListFilter} from "./adminUiV2";
import {enrichAdminListFilters} from "./enrichAdminListFilters";

const prioritySchema = new mongoose.Schema({
  name: {required: true, type: String},
  priority: {enum: ["low", "high"], type: String},
  status: {enum: ["open", "closed"], required: true, type: String},
});
const PriorityModel =
  mongoose.models.AdminEnrichPriority ?? mongoose.model("AdminEnrichPriority", prioritySchema);

describe("enrichAdminListFilters", () => {
  it("sets allowEmpty for optional choice filters from the schema", () => {
    const filters: AdminListFilter[] = [
      {
        choices: [{label: "High", value: "high"}],
        field: "priority",
        kind: "choice",
      },
      {
        choices: [{label: "Open", value: "open"}],
        field: "status",
        kind: "choice",
      },
    ];
    const enriched = enrichAdminListFilters(filters, PriorityModel);
    expect<unknown>(enriched?.[0]).toEqual({...filters[0], allowEmpty: true});
    expect(enriched?.[1]).toEqual(filters[1]);
  });

  it("preserves explicit allowEmpty", () => {
    const filters: AdminListFilter[] = [
      {
        allowEmpty: false,
        choices: [{label: "High", value: "high"}],
        field: "priority",
        kind: "choice",
      },
    ];
    expect(enrichAdminListFilters(filters, PriorityModel)).toEqual(filters);
  });
});
