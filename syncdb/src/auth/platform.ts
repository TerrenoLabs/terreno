import {Platform} from "react-native";

/** True on react-native-web. Its own module so native tests can mock the platform. */
export const IsWeb = Platform.OS === "web";
