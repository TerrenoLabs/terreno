import type {RegisteredUser, User} from "@terreno/api";

export const asUser: User = {} as RegisteredUser;
export const asRegistered: RegisteredUser = {} as User;

// @ts-expect-error name is not on the default user
export const name = ({} as RegisteredUser).name;
