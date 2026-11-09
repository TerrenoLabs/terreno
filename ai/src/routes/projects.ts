import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  createOpenApiBuilder,
  modelRouter,
  Permissions,
} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";

import {getProjectModel} from "../models/project";
import type {ProjectDocument} from "../types";

export const addProjectRoutes = (
  router: express.Router,
  options?: {openApiOptions?: Record<string, unknown>}
): void => {
  // Add memory to a project (registered before modelRouter so it isn't shadowed)
  router.post(
    "/gpt/projects/:id/memories",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options?.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Add a memory to a project")
        .withPathParameter("id", {type: "string"})
        .withRequestBody({
          category: {type: "string"},
          text: {type: "string"},
        })
        .withResponse(200, {data: {type: "object"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {id} = req.params;
      const {text, category} = req.body;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

      if (!text || typeof text !== "string") {
        throw new APIError({status: 400, title: "text is required"});
      }

      const project = await getProjectModel().findById(id);
      if (!project) {
        throw new APIError({status: 404, title: "Project not found"});
      }
      if (project.userId.toString() !== userId?.toString()) {
        throw new APIError({status: 403, title: "Not authorized"});
      }

      project.memories.push({category, source: "user", text});
      await project.save();

      return res.json({data: project.memories[project.memories.length - 1]});
    })
  );

  // Remove memory from a project
  router.delete(
    "/gpt/projects/:id/memories/:memoryId",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options?.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Remove a memory from a project")
        .withPathParameter("id", {type: "string"})
        .withPathParameter("memoryId", {type: "string"})
        .withResponse(200, {data: {type: "object"}})
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const {id, memoryId} = req.params;
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

      const project = await getProjectModel().findById(id);
      if (!project) {
        throw new APIError({status: 404, title: "Project not found"});
      }
      if (project.userId.toString() !== userId?.toString()) {
        throw new APIError({status: 403, title: "Not authorized"});
      }

      const memoryIndex = project.memories.findIndex((m) => m._id?.toString() === memoryId);
      if (memoryIndex === -1) {
        throw new APIError({status: 404, title: "Memory not found"});
      }

      project.memories.splice(memoryIndex, 1);
      await project.save();

      return res.json({data: {deleted: true}});
    })
  );

  router.use(
    "/gpt/projects",
    modelRouter(getProjectModel(), {
      ...options?.openApiOptions,
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsOwner],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsOwner],
        update: [Permissions.IsOwner],
      },
      preCreate: (body, req: express.Request) =>
        ({
          ...body,
          userId: (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id,
        }) as unknown as ProjectDocument,
      queryFields: ["userId"],
      queryFilter: (user?: {id?: string}) => ({userId: user?.id}),
      sort: "-updated",
    })
  );
};
