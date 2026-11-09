import Constants from "expo-constants";

import {parseSocketTransports} from "@/utils/parseSocketTransports";

/** Socket.io transports for the realtime and syncdb sockets, from `extra.SOCKET_TRANSPORTS`. */
export const socketTransports = parseSocketTransports(
  Constants.expoConfig?.extra?.SOCKET_TRANSPORTS
);
