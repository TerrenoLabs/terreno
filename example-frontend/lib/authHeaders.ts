/** `{Authorization: "Bearer …"}` for the current session token, or `{}` when signed out. */
export const bearerAuthHeaders = async (
  getToken: () => Promise<string | null>
): Promise<Record<string, string>> => {
  try {
    const token = await getToken();
    if (!token) {
      return {};
    }
    return {Authorization: `Bearer ${token}`};
  } catch (error: unknown) {
    console.warn("[auth] Could not read the session token", error);
    return {};
  }
};
