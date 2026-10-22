import {asJsonBody} from "../adminRpc";
import {
  type AdminRpcQueryState,
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "../useAdminRpc";
import type {ListQueryData} from "./normalizeListData";
import {adminOrganizationHeaders} from "./organizationHeaders";

interface OrganizationMutation {
  id: string;
  body: Record<string, unknown>;
}

interface MembershipMutation extends OrganizationMutation {
  memberId: string;
}

interface QueryOptions {
  skip?: boolean;
}

type Mutation<Arg> = [(arg: Arg) => {unwrap: () => Promise<unknown>}, {isLoading: boolean}];

const ORGANIZATION_TAGS = ["organizations"] as const;
const MEMBER_TAGS = ["organization-members"] as const;

/** Single-organization read: the document, or `{data}` when a host keeps the envelope. */
type OrganizationReadData = Record<string, unknown> & {data?: unknown};

export interface OrganizationsApi {
  useCreateMutation: () => Mutation<Record<string, unknown>>;
  useDeleteMutation: () => Mutation<string>;
  useListQuery: <T = Record<string, unknown>>(
    arg?: undefined,
    options?: QueryOptions
  ) => AdminRpcQueryState<ListQueryData<T>>;
  useMemberAttachMutation: () => Mutation<OrganizationMutation>;
  /** `body` is ignored; kept so callers can share the membership mutation shape. */
  useMemberRemoveMutation: () => Mutation<
    Omit<MembershipMutation, "body"> & {body?: Record<string, unknown>}
  >;
  useMembersQuery: <T = Record<string, unknown>>(
    id: string,
    options?: QueryOptions
  ) => AdminRpcQueryState<ListQueryData<T>>;
  useMemberUpdateMutation: () => Mutation<MembershipMutation>;
  useMineQuery: <T = Record<string, unknown>>(
    arg?: undefined,
    options?: QueryOptions
  ) => AdminRpcQueryState<ListQueryData<T>>;
  useReadQuery: (id: string, options?: QueryOptions) => AdminRpcQueryState<OrganizationReadData>;
  useUpdateMutation: () => Mutation<OrganizationMutation>;
}

const ORGANIZATION_MUTATION = {
  invalidatesTags: ORGANIZATION_TAGS,
  transformResponse: unwrapAdminEnvelope,
};
const MEMBER_MUTATION = {invalidatesTags: MEMBER_TAGS, transformResponse: unwrapAdminEnvelope};

/** Hooks for the framework OrgsApp routes over the host-bound admin fetch client. */
export const useOrganizationsApi = (basePath = "/orgs"): OrganizationsApi => {
  const rpc = useAdminRpc();
  return {
    useCreateMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, ORGANIZATION_MUTATION);
      return [
        (body: Record<string, unknown>) =>
          trigger({body: asJsonBody(body), method: "POST", url: basePath}),
        meta,
      ];
    },
    useDeleteMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, ORGANIZATION_MUTATION);
      return [(id: string) => trigger({method: "DELETE", url: `${basePath}/${id}`}), meta];
    },
    useListQuery: <T = Record<string, unknown>>(_arg?: undefined, options?: QueryOptions) =>
      useAdminRpcQuery<ListQueryData<T>>({
        providesTags: ORGANIZATION_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        transformResponse: unwrapAdminEnvelope,
        url: basePath,
      }),
    useMemberAttachMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, MEMBER_MUTATION);
      return [
        ({body, id}: OrganizationMutation) =>
          trigger({
            body: asJsonBody(body),
            headers: adminOrganizationHeaders(id),
            method: "POST",
            url: `${basePath}/${id}/members`,
          }),
        meta,
      ];
    },
    useMemberRemoveMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, MEMBER_MUTATION);
      return [
        ({id, memberId}: Omit<MembershipMutation, "body">) =>
          trigger({
            headers: adminOrganizationHeaders(id),
            method: "DELETE",
            url: `${basePath}/${id}/members/${memberId}`,
          }),
        meta,
      ];
    },
    useMembersQuery: <T = Record<string, unknown>>(id: string, options?: QueryOptions) =>
      useAdminRpcQuery<ListQueryData<T>>({
        headers: adminOrganizationHeaders(id),
        providesTags: MEMBER_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        transformResponse: unwrapAdminEnvelope,
        url: `${basePath}/${id}/members`,
      }),
    useMemberUpdateMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, MEMBER_MUTATION);
      return [
        ({body, id, memberId}: MembershipMutation) =>
          trigger({
            body: asJsonBody(body),
            headers: adminOrganizationHeaders(id),
            method: "PATCH",
            url: `${basePath}/${id}/members/${memberId}`,
          }),
        meta,
      ];
    },
    useMineQuery: <T = Record<string, unknown>>(_arg?: undefined, options?: QueryOptions) =>
      useAdminRpcQuery<ListQueryData<T>>({
        providesTags: ORGANIZATION_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        transformResponse: unwrapAdminEnvelope,
        url: `${basePath}/mine`,
      }),
    useReadQuery: (id, options) =>
      useAdminRpcQuery<OrganizationReadData>({
        headers: adminOrganizationHeaders(id),
        providesTags: ORGANIZATION_TAGS,
        rpc,
        skip: Boolean(options?.skip),
        transformResponse: unwrapAdminEnvelope,
        url: `${basePath}/${id}`,
      }),
    useUpdateMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, ORGANIZATION_MUTATION);
      return [
        ({body, id}: OrganizationMutation) =>
          trigger({
            body: asJsonBody(body),
            headers: adminOrganizationHeaders(id),
            method: "PATCH",
            url: `${basePath}/${id}`,
          }),
        meta,
      ];
    },
  };
};
