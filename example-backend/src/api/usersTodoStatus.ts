import {type MCPToolResult, registerMCPTool, type User} from "@terreno/api";
import {z} from "zod";

import {Todo} from "../models/todo";
import {User as UserModel} from "../models/user";

interface UserTodoItem {
  completed: boolean;
  id: string;
  title: string;
}

interface UserTodoStatus {
  email: string;
  id: string;
  name: string;
  todos: UserTodoItem[];
}

const usersTodoStatusSchema = z.object({}).strict();

const permissionDeniedResult = (): MCPToolResult => {
  return {
    content: [{text: JSON.stringify({error: "Permission denied: admin required"}), type: "text"}],
    isError: true,
  };
};

const textResult = (data: unknown): MCPToolResult => {
  return {
    content: [{text: JSON.stringify(data), type: "text"}],
  };
};

export const listUsersTodoStatuses = async ({user}: {user?: User}): Promise<MCPToolResult> => {
  if (!user?.admin) {
    return permissionDeniedResult();
  }

  const users = await UserModel.find({}).select("email name").sort({email: 1}).lean();
  const todos = await Todo.find({}).select("completed ownerId title").sort({title: 1}).lean();

  const todosByOwner = new Map<string, UserTodoItem[]>();
  for (const todo of todos) {
    const ownerId = String(todo.ownerId);
    const items = todosByOwner.get(ownerId) ?? [];
    items.push({
      completed: todo.completed === true,
      id: String(todo._id),
      title: todo.title,
    });
    todosByOwner.set(ownerId, items);
  }

  const statuses: UserTodoStatus[] = users.map((listedUser) => {
    const id = String(listedUser._id);
    return {
      email: listedUser.email,
      id,
      name: listedUser.name,
      todos: todosByOwner.get(id) ?? [],
    };
  });

  return textResult({users: statuses});
};

export const registerUsersTodoStatusTool = (): void => {
  registerMCPTool({
    // Only reads, so a read-only OAuth grant keeps it.
    access: "read",
    description:
      "List every user with each of their todos and completed status. Admin only. Use this to summarize who still has open work.",
    handler: async (_args, user) => {
      return listUsersTodoStatuses({user});
    },
    name: "users_todo_statuses",
    zodSchema: usersTodoStatusSchema,
  });
};
