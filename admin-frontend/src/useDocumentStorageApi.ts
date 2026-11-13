import {withQueryString} from "./adminRpc";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "./useAdminRpc";

const DOCUMENT_STORAGE_TAGS = ["documentStorage"] as const;

/** Document storage hooks: list, upload, download, delete, and folder management. */
export const useDocumentStorageApi = (basePath: string) => {
  const rpc = useAdminRpc();
  return {
    useCreateFolderMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: DOCUMENT_STORAGE_TAGS});
      return [
        ({folderName, prefix}: {folderName: string; prefix?: string}) =>
          trigger({
            body: {folderName, prefix},
            method: "POST",
            url: `${basePath}/folder`,
          }),
        meta,
      ] as const;
    },
    useDeleteFolderMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: DOCUMENT_STORAGE_TAGS});
      return [
        (folderPath: string) =>
          trigger({
            method: "DELETE",
            url: `${basePath}/folder/${encodeURIComponent(folderPath)}`,
          }),
        meta,
      ] as const;
    },
    useDeleteMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: DOCUMENT_STORAGE_TAGS});
      return [
        (filePath: string) =>
          trigger({
            method: "DELETE",
            url: `${basePath}/${encodeURIComponent(filePath)}`,
          }),
        meta,
      ] as const;
    },
    useLazyDownloadQuery: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc);
      return [
        (filePath: string) =>
          trigger({
            method: "GET",
            parseAs: "blob",
            url: `${basePath}/download/${encodeURIComponent(filePath)}`,
          }),
        meta,
      ] as const;
    },
    useListQuery: (prefix?: string, options?: {skip?: boolean}) =>
      useAdminRpcQuery({
        providesTags: DOCUMENT_STORAGE_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        url: withQueryString({
          params: prefix ? {prefix} : undefined,
          url: `${basePath}/`,
        }),
      }),
    useUploadMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: DOCUMENT_STORAGE_TAGS});
      return [
        ({formData, prefix}: {formData: FormData; prefix?: string}) => {
          if (prefix) {
            formData.append("prefix", prefix);
          }
          return trigger({
            body: formData,
            method: "POST",
            url: `${basePath}/`,
          });
        },
        meta,
      ] as const;
    },
  };
};
