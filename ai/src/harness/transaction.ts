import mongoose, {type ClientSession} from "mongoose";

/** Run `work` in one Mongo transaction; every write inside must pass `session`. */
export const inTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>
): Promise<T> => {
  const session = await mongoose.connection.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
};
