import type {AdminFieldValue, AdminModelConfig, AdminSyncDb} from "./types";

export interface WindowedAdminTableGate {
  modelConfig?: AdminModelConfig;
  syncDb?: AdminSyncDb;
}

export const isWindowedAdminTable = ({modelConfig, syncDb}: WindowedAdminTableGate): boolean => {
  if (!syncDb || !modelConfig) {
    return false;
  }
  if (modelConfig.adminBroadcast !== true) {
    return false;
  }
  if (!modelConfig.syncCollection) {
    return false;
  }
  return modelConfig.fields._id?.type === "string";
};

export const resolveWindowedTableRows = ({
  collection,
  getEntity,
  membershipIds,
  restById,
}: {
  collection: string;
  getEntity: AdminSyncDb["store"]["getEntity"];
  membershipIds: string[];
  restById: Map<string, Record<string, AdminFieldValue>>;
}): Array<Record<string, AdminFieldValue>> => {
  const rows: Array<Record<string, AdminFieldValue>> = [];
  for (const id of membershipIds) {
    const entity = getEntity({collection, id});
    if (entity?.deleted) {
      continue;
    }
    const storeData =
      entity?.data && typeof entity.data === "object"
        ? (entity.data as Record<string, AdminFieldValue>)
        : undefined;
    const restData = restById.get(id);
    const data = storeData ?? restData;
    if (!data) {
      continue;
    }
    rows.push({...data, _id: id});
  }
  return rows;
};
