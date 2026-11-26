import type {RegisteredUser} from "@terreno/api";
import type {Types} from "mongoose";

declare module "@terreno/api" {
  interface TerrenoRegister {
    // A hydrated Mongoose user's `_id` is a document ObjectId (`Types.ObjectId`), not a string.
    user: {_id: Types.ObjectId; id: string; admin: boolean; name: string};
  }
}

export const name: string = ({} as RegisteredUser).name;

// @ts-expect-error missingField is not on the registered user
export const missing = ({} as RegisteredUser).missingField;
