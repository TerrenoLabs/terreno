import {beforeEach, describe, expect, it} from "bun:test";
import {getAllMCPTools, type User} from "@terreno/api";

import {Todo} from "../models/todo";
import {User as UserModel} from "../models/user";
import {listUsersTodoStatuses, registerUsersTodoStatusTool} from "./usersTodoStatus";

const parseResult = (result: {
  content: Array<{text: string}>;
  isError?: boolean;
}): {
  data?: {users: Array<{email: string; todos: Array<{completed: boolean; title: string}>}>};
  error?: string;
  isError?: boolean;
} => {
  const parsed = JSON.parse(result.content[0].text) as {
    error?: string;
    users?: Array<{email: string; todos: Array<{completed: boolean; title: string}>}>;
  };
  if (parsed.error) {
    return {error: parsed.error, isError: result.isError};
  }
  return {
    data: parsed as {
      users: Array<{email: string; todos: Array<{completed: boolean; title: string}>}>;
    },
  };
};

const asUser = (doc: {_id: unknown; admin?: boolean}): User => {
  return {
    _id: doc._id,
    admin: doc.admin === true,
    id: String(doc._id),
  } as unknown as User;
};

describe("listUsersTodoStatuses", () => {
  beforeEach(async () => {
    await UserModel.deleteMany({});
    await Todo.collection.deleteMany({});
  });

  it("refuses anonymous and non-admin callers", async () => {
    const anonymous = await listUsersTodoStatuses({});
    expect(anonymous.isError).toBe(true);
    expect(parseResult(anonymous).error).toContain("admin required");

    const member = await UserModel.register(
      {email: "member@example.com", name: "Member"} as never,
      "password12345"
    );
    const memberResult = await listUsersTodoStatuses({user: asUser(member)});
    expect(memberResult.isError).toBe(true);
  });

  it("lists every user with their todo completed flags", async () => {
    const admin = await UserModel.register(
      {admin: true, email: "admin@example.com", name: "Admin"} as never,
      "password12345"
    );
    const ada = await UserModel.register(
      {email: "ada@example.com", name: "Ada"} as never,
      "password12345"
    );
    const ben = await UserModel.register(
      {email: "ben@example.com", name: "Ben"} as never,
      "password12345"
    );

    await Todo.create({completed: true, ownerId: ada._id, title: "Ship MCP"});
    await Todo.create({completed: false, ownerId: ada._id, title: "Write docs"});
    await Todo.create({completed: false, ownerId: ben._id, title: "Review PR"});

    const result = await listUsersTodoStatuses({user: asUser(admin)});
    const parsed = parseResult(result);

    expect(result.isError).toBeUndefined();
    expect(parsed.data?.users.map((row) => row.email)).toEqual([
      "ada@example.com",
      "admin@example.com",
      "ben@example.com",
    ]);
    expect(
      parsed.data?.users
        .find((row) => row.email === "ada@example.com")
        ?.todos.map((todo) => ({
          completed: todo.completed,
          title: todo.title,
        }))
    ).toEqual([
      {completed: true, title: "Ship MCP"},
      {completed: false, title: "Write docs"},
    ]);
    expect(parsed.data?.users.find((row) => row.email === "admin@example.com")?.todos).toEqual([]);
    expect(
      parsed.data?.users
        .find((row) => row.email === "ben@example.com")
        ?.todos.map((todo) => ({
          completed: todo.completed,
          title: todo.title,
        }))
    ).toEqual([{completed: false, title: "Review PR"}]);
  });

  it("registers users_todo_statuses as a custom MCP tool", () => {
    // registerMCPTool replaces by name; clearing the shared catalog here would drop the
    // routers other test files in this process registered.
    registerUsersTodoStatusTool();
    expect(getAllMCPTools().map((tool) => tool.name)).toContain("users_todo_statuses");
  });
});
