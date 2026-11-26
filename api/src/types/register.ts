import type {User} from "../auth";

/**
 * Registry an app augments to tell @terreno/api its own user type:
 * `declare module "@terreno/api" { interface TerrenoRegister { user: AppUser } }`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: consumers fill this in through module augmentation
export interface TerrenoRegister {}

/** The app's registered user type, or the framework `User` when nothing is registered. */
export type RegisteredUser = TerrenoRegister extends {user: infer TUser} ? TUser : User;
