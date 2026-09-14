import { getDatabase } from "@/db/database";
import type { AppDatabase } from "@/db/driver";

class RejectedMutation extends Error {
  constructor(readonly response: Response) { super("Mutation rejected"); }
}

// HTTP error responses must roll back just like thrown domain errors.
export async function mutationTransaction<T extends Response>(callback: (db: AppDatabase) => Promise<T>): Promise<T> {
  try {
    return await getDatabase().transaction(async (db) => {
      const response = await callback(db);
      if (!response.ok) throw new RejectedMutation(response);
      return response;
    });
  } catch (error) {
    if (error instanceof RejectedMutation) return error.response as T;
    throw error;
  }
}
