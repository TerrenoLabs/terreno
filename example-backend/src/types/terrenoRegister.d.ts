import type {UserDocument} from "./models/userTypes";

declare module "@terreno/api" {
  interface TerrenoRegister {
    user: UserDocument;
  }
}
