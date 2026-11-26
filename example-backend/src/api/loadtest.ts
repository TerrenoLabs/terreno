/**
 * Load-test collectionActions for the SyncDB "load lab" admin screen.
 *
 * These endpoints drive server-side writes to the owner-scoped `todos` collection so
 * the running frontend's @terreno/syncdb client sees them arrive as inbound `sync:delta`
 * patches over the websocket — i.e. they simulate "other clients" mutating shared data.
 *
 * - loadtestGenerate: bulk-insert N random todos
 * - loadtestChurn:    a batch of random create/update/delete ops
 * - loadtestClear:    soft-delete every todo for the user
 *
 * Admin-guarded because the screen lives in the admin panel. Writes go through the
 * model (insertMany / save) so the syncPlugin stamps `_syncSeq`.
 */
import type {CollectionActionConfig} from "@terreno/api";
import {APIError, Permissions, z} from "@terreno/api";
import {Todo} from "../models/todo";
import type {TodoDocument} from "../types/models/todoTypes";
import type {UserDocument} from "../types/models/userTypes";

/** Hard caps so a stray UI value can't wedge the dev server. */
const MAX_GENERATE = 5_000;
const MAX_CHURN_OPS = 500;
/** Save concurrency for update/delete batches. */
const SAVE_CHUNK = 25;

const TITLE_ADJECTIVES = [
  "Urgent",
  "Quick",
  "Blocked",
  "Draft",
  "Recurring",
  "Legacy",
  "Flaky",
  "Critical",
  "Minor",
  "Stale",
];
const TITLE_NOUNS = [
  "sync audit",
  "cache purge",
  "delta replay",
  "outbox flush",
  "conflict merge",
  "cursor rebuild",
  "socket reconnect",
  "snapshot import",
  "index migration",
  "tombstone sweep",
];
const PRIORITIES = ["low", "medium", "high"] as const;
const TAG_POOL = ["load", "sync", "delta", "outbox", "conflict", "realtime", "bench", "chaos"];

const randomInt = (max: number): number => Math.floor(Math.random() * max);

const randomTitle = (): string =>
  `${TITLE_ADJECTIVES[randomInt(TITLE_ADJECTIVES.length)]} ${
    TITLE_NOUNS[randomInt(TITLE_NOUNS.length)]
  } #${randomInt(100_000)}`;

const randomTags = (): string[] => {
  const count = randomInt(3);
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) {
    tags.add(TAG_POOL[randomInt(TAG_POOL.length)]);
  }
  return [...tags];
};

const buildTodoSeed = (ownerId: unknown): Record<string, unknown> => ({
  completed: Math.random() < 0.25,
  ownerId,
  priority: PRIORITIES[randomInt(PRIORITIES.length)],
  tags: randomTags(),
  title: randomTitle(),
});

const requireOwnerId = (user: UserDocument | undefined): UserDocument["_id"] => {
  const ownerId = user?._id;
  if (!ownerId) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  return ownerId;
};

/** Run `task` over `items` with bounded concurrency so batches don't open 1000 sockets at once. */
const runChunked = async <T>(items: T[], task: (item: T) => Promise<void>): Promise<void> => {
  for (let i = 0; i < items.length; i += SAVE_CHUNK) {
    const chunk = items.slice(i, i + SAVE_CHUNK);
    await Promise.all(chunk.map(task));
  }
};

/** Sample up to `size` random non-deleted todo documents for the owner. */
const sampleTodos = async (ownerId: unknown, size: number): Promise<TodoDocument[]> => {
  if (size <= 0) {
    return [];
  }
  const sampled = (await Todo.aggregate([
    {$match: {deleted: {$ne: true}, ownerId}},
    {$sample: {size}},
    {$project: {_id: 1}},
  ])) as {_id: string}[];
  if (sampled.length === 0) {
    return [];
  }
  return Todo.find({_id: {$in: sampled.map((row) => row._id)}});
};

const clampCount = (value: unknown, max: number): number => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.min(Math.floor(num), max);
};

/** Coerce JSON numbers; non-numeric values become 0 so clampCount can no-op. */
const optionalClampedCount = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}, z.number().optional());

const generateBodySchema = z.object({count: optionalClampedCount}).strict();
const churnBodySchema = z
  .object({
    creates: optionalClampedCount,
    deletes: optionalClampedCount,
    updates: optionalClampedCount,
  })
  .strict();
const generateResponseSchema = z.object({created: z.number()}).strict();
const churnResponseSchema = z
  .object({
    created: z.number(),
    deleted: z.number(),
    updated: z.number(),
  })
  .strict();
const clearResponseSchema = z.object({deleted: z.number()}).strict();

const adminUpdateAccess = {action: "update" as const, resource: "todo"};

export const todoLoadTestCollectionActions: Record<
  string,
  CollectionActionConfig<unknown, unknown, unknown>
> = {
  loadtestChurn: {
    access: adminUpdateAccess,
    body: churnBodySchema,
    handler: async ({body, user}) => {
      const ownerId = requireOwnerId(user);
      const payload = body as z.infer<typeof churnBodySchema>;
      const creates = clampCount(payload.creates ?? 0, MAX_CHURN_OPS);
      const updates = clampCount(payload.updates ?? 0, MAX_CHURN_OPS);
      const deletes = clampCount(payload.deletes ?? 0, MAX_CHURN_OPS);

      if (creates > 0) {
        await Todo.insertMany(Array.from({length: creates}, () => buildTodoSeed(ownerId)));
      }

      const pool = await sampleTodos(ownerId, updates + deletes);
      const toUpdate = pool.slice(0, updates);
      const toDelete = pool.slice(updates, updates + deletes);

      await runChunked(toUpdate, async (todo) => {
        todo.completed = !todo.completed;
        todo.priority = PRIORITIES[randomInt(PRIORITIES.length)];
        await todo.save();
      });

      await runChunked(toDelete, async (todo) => {
        todo.deleted = true;
        await todo.save();
      });

      return {created: creates, deleted: toDelete.length, updated: toUpdate.length};
    },
    method: "POST",
    permissions: [Permissions.IsAdmin],
    response: churnResponseSchema,
    summary: "Apply a batch of random create/update/delete todo ops (load testing)",
    tag: "loadtest",
  },
  loadtestClear: {
    access: adminUpdateAccess,
    handler: async ({user}) => {
      const ownerId = requireOwnerId(user);
      const todos = await Todo.find({deleted: {$ne: true}, ownerId});
      await runChunked(todos, async (todo) => {
        todo.deleted = true;
        await todo.save();
      });
      return {deleted: todos.length};
    },
    method: "POST",
    permissions: [Permissions.IsAdmin],
    response: clearResponseSchema,
    summary: "Soft-delete every todo for the current user (load testing reset)",
    tag: "loadtest",
  },
  loadtestGenerate: {
    access: adminUpdateAccess,
    body: generateBodySchema,
    handler: async ({body, user}) => {
      const ownerId = requireOwnerId(user);
      const count = clampCount(
        (body as z.infer<typeof generateBodySchema>).count ?? 1_000,
        MAX_GENERATE
      );
      if (count === 0) {
        return {created: 0};
      }
      const seeds = Array.from({length: count}, () => buildTodoSeed(ownerId));
      await Todo.insertMany(seeds);
      return {created: count};
    },
    method: "POST",
    permissions: [Permissions.IsAdmin],
    response: generateResponseSchema,
    summary: "Bulk-generate random todos for the current user (load testing)",
    tag: "loadtest",
  },
};
