import {beforeEach, describe, expect, it} from "bun:test";
import {confirmAskInputSchema} from "@terreno/blocks";
import type mongoose from "mongoose";

import {Todo} from "../models/todo";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {createTodoTools, DELETE_COMPLETED_TODOS_TOOL, todoToolApprovals} from "./todoTools";

const createUser = async (): Promise<UserDocument> =>
  UserModel.register(
    {
      admin: false,
      email: `todo-tools-${crypto.randomUUID()}@example.com`,
      name: "Todo tools",
    } as never,
    "password12345"
  ) as unknown as Promise<UserDocument>;

const runDelete = async (userId: mongoose.Types.ObjectId): Promise<unknown> => {
  const deleteTool = createTodoTools({userId})[DELETE_COMPLETED_TODOS_TOOL];
  if (!deleteTool?.execute) {
    throw new Error("deleteCompletedTodos has no execute");
  }
  return deleteTool.execute({}, {messages: [], toolCallId: "call_delete"});
};

describe("todo tools", () => {
  beforeEach(async () => {
    await Todo.collection.deleteMany({});
  });

  it("needs approval before it runs", () => {
    const deleteTool = createTodoTools({userId: undefined})[DELETE_COMPLETED_TODOS_TOOL];

    expect(deleteTool?.needsApproval).toBe(true);
  });

  it("soft-deletes only the user's completed todos and names them", async () => {
    const user = await createUser();
    const other = await createUser();
    await Todo.create([
      {completed: true, ownerId: user._id, title: "Buy milk"},
      {completed: true, ownerId: user._id, title: "File taxes"},
      {completed: false, ownerId: user._id, title: "Walk the dog"},
      {completed: true, ownerId: other._id, title: "Someone else's todo"},
    ]);

    const result = await runDelete(user._id as mongoose.Types.ObjectId);

    expect(result).toEqual({deleted: 2, titles: ["Buy milk", "File taxes"]});
    const remaining = await Todo.find({}).sort({title: 1});
    expect(remaining.map((todo) => todo.title)).toEqual(["Someone else's todo", "Walk the dog"]);
    const deleted = await Todo.collection.find({deleted: true}).toArray();
    expect(deleted.map((todo) => todo.title).sort()).toEqual(["Buy milk", "File taxes"]);
  });

  it("deletes nothing without a signed-in user", async () => {
    const user = await createUser();
    await Todo.create({completed: true, ownerId: user._id, title: "Buy milk"});

    const deleteTool = createTodoTools({userId: undefined})[DELETE_COMPLETED_TODOS_TOOL];
    const result = await deleteTool?.execute?.({}, {messages: [], toolCallId: "call_delete"});

    expect(result).toEqual({deleted: 0, titles: []});
    expect(await Todo.countDocuments({})).toBe(1);
  });

  it("asks for approval with a destructive Delete button and a Keep them button", () => {
    const input = todoToolApprovals[DELETE_COMPLETED_TODOS_TOOL]?.({});

    expect(confirmAskInputSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      confirmLabel: "Delete",
      denyLabel: "Keep them",
      destructive: true,
    });
  });
});
