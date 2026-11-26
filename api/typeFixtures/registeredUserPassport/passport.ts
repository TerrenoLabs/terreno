import type {} from "@terreno/api/expressUser";

declare module "@terreno/api" {
  interface TerrenoRegister {
    user: {_id: string; id: string; admin: boolean; name: string};
  }
}

declare const req: Express.Request;
export const reqName: string | undefined = req.user?.name;
