import type {BackgroundTask, ScriptRunListResponse} from "./types";
import {
  type AdminRpcQueryState,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

const SCRIPT_RUN_TAGS = ["admin_scriptRuns"] as const;
const SCRIPT_TASK_TAGS = ["admin_scriptTask"] as const;
const SCRIPT_MUTATION_TAGS = ["admin_scriptRuns", "admin_scriptTask"] as const;

export interface ScriptRunsQueryArg {
  /** Limit history to a single script by `taskType`. Omit for all scripts. */
  name?: string;
  page?: number;
  limit?: number;
}

interface ScriptQueryOptions {
  skip?: boolean;
  pollingInterval?: number;
}

export interface AdminScriptsApi {
  useCancelScriptTaskMutation: () => [
    (taskId: string) => {unwrap: () => Promise<{task: BackgroundTask; message: string}>},
    {isLoading: boolean},
  ];
  useGetScriptTaskQuery: (
    taskId: string,
    options?: ScriptQueryOptions
  ) => AdminRpcQueryState<{task: BackgroundTask}>;
  useListScriptRunsQuery: (
    arg?: ScriptRunsQueryArg,
    options?: ScriptQueryOptions
  ) => AdminRpcQueryState<ScriptRunListResponse>;
  useRunScriptMutation: () => [
    (args: {name: string; wetRun: boolean}) => {unwrap: () => Promise<{taskId: string}>},
    {isLoading: boolean},
  ];
}

/** Admin script hooks: run, poll task status, cancel, and list run history. */
export const useAdminScripts = (apiBase: string): AdminScriptsApi => {
  const rpc = useAdminRpc();
  return {
    useCancelScriptTaskMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {
        invalidatesTags: SCRIPT_MUTATION_TAGS,
      });
      return [
        (taskId: string) => trigger({method: "DELETE", url: `${apiBase}/scripts/tasks/${taskId}`}),
        meta,
      ] as ReturnType<AdminScriptsApi["useCancelScriptTaskMutation"]>;
    },
    useGetScriptTaskQuery: (taskId, options) =>
      useAdminRpcQuery<{task: BackgroundTask}>({
        pollingInterval: options?.pollingInterval,
        providesTags: SCRIPT_TASK_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        url: `${apiBase}/scripts/tasks/${taskId}`,
      }),
    useListScriptRunsQuery: (arg, options) => {
      const params = new URLSearchParams();
      params.set("page", String(arg?.page ?? 1));
      params.set("limit", String(arg?.limit ?? 25));
      if (arg?.name) {
        params.set("name", arg.name);
      }
      return useAdminRpcQuery<ScriptRunListResponse>({
        pollingInterval: options?.pollingInterval,
        providesTags: SCRIPT_RUN_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        url: `${apiBase}/scripts/runs?${params.toString()}`,
      });
    },
    useRunScriptMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: SCRIPT_RUN_TAGS});
      return [
        ({name, wetRun}: {name: string; wetRun: boolean}) =>
          trigger({
            method: "POST",
            url: `${apiBase}/scripts/${name}/run?wetRun=${wetRun}`,
          }),
        meta,
      ] as ReturnType<AdminScriptsApi["useRunScriptMutation"]>;
    },
  };
};
