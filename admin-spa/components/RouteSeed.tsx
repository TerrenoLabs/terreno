import {AdminRpcSeed} from "@terreno/admin-frontend";
import {useLoaderData} from "expo-router";
import type React from "react";
import {useMemo} from "react";

/**
 * Seeds the route's `useAdminRpcQuery` reads with its loader's bodies, so the screen renders its
 * data on the first render. On a client navigation without loader data it seeds nothing.
 */
export const RouteSeed: React.FC<{children: React.ReactNode}> = ({children}) => {
  const rpc = (useLoaderData() as {rpc?: Record<string, unknown>} | undefined)?.rpc;
  const data = useMemo((): Record<string, unknown> => rpc ?? {}, [rpc]);
  return <AdminRpcSeed data={data}>{children}</AdminRpcSeed>;
};
