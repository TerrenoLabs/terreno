import type {RegisteredUser} from "@terreno/api";

declare module "@terreno/api" {
  interface TerrenoRegister {
    user: {_id: string; id: string; admin: boolean; name: string};
  }
}

export const name: string = ({} as RegisteredUser).name;

// @ts-expect-error missingField is not on the registered user
export const missing = ({} as RegisteredUser).missingField;
