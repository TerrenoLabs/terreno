import type {ApprovalAskInput} from "@terreno/ai";
import type {Tool} from "ai";
import {tool, zodSchema} from "ai";
import type mongoose from "mongoose";
import {z} from "zod";

import {Todo} from "../models/todo";

export const DELETE_COMPLETED_TODOS_TOOL = "deleteCompletedTodos";

interface DeleteCompletedTodosResult {
  deleted: number;
  titles: string[];
}

/**
 * Host tools that act on the signed-in user's todos. They are built per request so each tool
 * only ever touches its caller's data.
 */
export const createTodoTools = ({
  userId,
}: {
  userId: mongoose.Types.ObjectId | string | undefined;
}): Record<string, Tool> => ({
  [DELETE_COMPLETED_TODOS_TOOL]: tool({
    description: "Delete all of the signed-in user's completed todos.",
    execute: async (): Promise<DeleteCompletedTodosResult> => {
      if (!userId) {
        return {deleted: 0, titles: []};
      }
      const todos = await Todo.find({completed: true, ownerId: userId}).sort({_id: 1});
      // syncPlugin forbids bulk writes on synced models; saving each soft delete stamps its sync
      // sequence so open Todos screens drop the rows.
      for (const todo of todos) {
        todo.deleted = true;
        await todo.save();
      }
      return {deleted: todos.length, titles: todos.map((todo) => todo.title)};
    },
    inputSchema: zodSchema(z.object({}).strict()),
    needsApproval: true,
  }),
});

export const todoToolApprovals: Record<string, ApprovalAskInput> = {
  [DELETE_COMPLETED_TODOS_TOOL]: () => ({
    confirmLabel: "Delete",
    denyLabel: "Keep them",
    destructive: true,
    prompt: "Delete all of your completed todos? You can't undo this.",
    title: "Delete completed todos",
  }),
};
