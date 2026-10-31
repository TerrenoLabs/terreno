import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {enrichModelRouterOptions} from "./adminModelRouter";
import type {ModelRouterOptions, OpenApiMiddleware} from "./api";

interface Widget {
  secret?: string;
  title: string;
}

const widgetSchema = new mongoose.Schema<Widget>(
  {
    secret: {description: "Hidden", type: String},
    title: {description: "Title", type: String},
  },
  {strict: "throw"}
);

const WidgetModel =
  (mongoose.models.CoverageWidget as mongoose.Model<Widget>) ??
  mongoose.model<Widget>("CoverageWidget", widgetSchema);

describe("enrichModelRouterOptions", () => {
  it("returns options unchanged when admin is omitted", () => {
    const options: ModelRouterOptions<Widget> = {
      permissions: {create: [], delete: [], list: [], read: [], update: []},
    };
    const enriched = enrichModelRouterOptions(WidgetModel, options, {});
    expect(enriched).toBe(options);
  });

  it("merges openApi from context when admin is omitted", () => {
    const options: ModelRouterOptions<Widget> = {
      permissions: {create: [], delete: [], list: [], read: [], update: []},
    };
    const openApi = {enabled: true} as unknown as OpenApiMiddleware;
    const enriched = enrichModelRouterOptions(WidgetModel, options, {openApi});
    expect(enriched.openApi).toEqual(openApi);
  });

  it("scrubs admin fields in preCreate/preUpdate and honors user hooks", async () => {
    const options: ModelRouterOptions<Widget> = {
      admin: {
        displayName: "Widgets",
        excludeFields: ["secret"],
        hiddenFields: [],
        listFields: ["title"],
      },
      permissions: {create: [], delete: [], list: [], read: [], update: []},
      preCreate: async (body) => {
        const widget = body as Partial<Widget>;
        return {...widget, title: `${widget.title}-created`};
      },
      preUpdate: async () => null,
    };
    const enriched = enrichModelRouterOptions(WidgetModel, options, {});
    const created = await enriched.preCreate?.({secret: "x", title: "Hi"}, {} as never);
    expect(created).toEqual({title: "Hi-created"});
    const updated = await enriched.preUpdate?.({secret: "x", title: "Hi"}, {} as never);
    expect(updated).toBeNull();
  });

  it("returns the user preUpdate body when it is not null", async () => {
    const enriched = enrichModelRouterOptions(
      WidgetModel,
      {
        admin: {
          displayName: "Widgets",
          excludeFields: ["secret"],
          hiddenFields: [],
          listFields: ["title"],
        },
        permissions: {create: [], delete: [], list: [], read: [], update: []},
        preUpdate: async (body) => ({...body, title: "next"}),
      },
      {}
    );
    const patched = await enriched.preUpdate?.({secret: "x", title: "Hi"}, {} as never);
    expect(patched).toEqual({title: "next"});
  });

  it("emits realtime admin events after create/update/delete", async () => {
    const events: unknown[] = [];
    const terrenoApp = {
      emitAdminModelChanged: (event: unknown) => {
        events.push(event);
      },
    };
    const options: ModelRouterOptions<Widget> = {
      admin: {
        displayName: "Widgets",
        excludeFields: ["secret"],
        hiddenFields: [],
        listFields: ["title"],
        realtime: true,
      },
      permissions: {create: [], delete: [], list: [], read: [], update: []},
      postCreate: async () => {},
      postDelete: async () => {},
      postUpdate: async () => {},
    };
    const enriched = enrichModelRouterOptions(WidgetModel, options, {
      routePath: "/widgets",
      terrenoApp: terrenoApp as never,
    });
    const doc = {_id: "abc", secret: "x", title: "Hi", toObject: () => ({_id: "abc", title: "Hi"})};
    const req = {user: {_id: "user-1"}} as never;
    await enriched.postCreate?.(doc as never, req);
    await enriched.postUpdate?.(doc as never, {}, req, doc as never);
    await enriched.postDelete?.(req, doc as never);
    expect(events).toHaveLength(3);
    expect((events[0] as {type: string}).type).toBe("create");
    expect((events[2] as {type: string; document?: unknown}).type).toBe("delete");
    expect((events[2] as {document?: unknown}).document).toBeUndefined();
  });

  it("skips realtime emit when the request has no user id", async () => {
    const events: unknown[] = [];
    const options: ModelRouterOptions<Widget> = {
      admin: {
        displayName: "Widgets",
        listFields: ["title"],
        realtime: true,
      },
      permissions: {create: [], delete: [], list: [], read: [], update: []},
    };
    const enriched = enrichModelRouterOptions(WidgetModel, options, {
      routePath: "/widgets",
      terrenoApp: {emitAdminModelChanged: (event: unknown) => events.push(event)} as never,
    });
    await enriched.postCreate?.({_id: "abc", title: "Hi"} as never, {user: {}} as never);
    expect(events).toHaveLength(0);
  });
});
