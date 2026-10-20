/**
 * Auth headers for the admin panel's host-bound fetch client, read from the token source that
 * store/index.ts registers with @terreno/rtk.
 */
import {getTokenSource} from "@terreno/rtk";

export const getAdminAuthHeaders = async (): Promise<HeadersInit> => {
  const token = await getTokenSource()?.getToken();
  if (!token) {
    return {};
  }
  return {Authorization: `Bearer ${token}`};
};
