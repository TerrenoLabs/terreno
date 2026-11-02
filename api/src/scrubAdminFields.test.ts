import {describe, expect, it} from "bun:test";
import {model, Schema} from "mongoose";

import type {AdminConfig} from "./adminTypes";
import {scrubAdminFields, stripAdminBodyFields} from "./scrubAdminFields";

const userSchema = new Schema({
  email: String,
  hash: String,
  name: String,
  salt: String,
});

model("ScrubUser", userSchema);

const todoSchema = new Schema({
  ownerId: {ref: "ScrubUser", type: Schema.Types.ObjectId},
  title: String,
});

const Todo = model("ScrubTodo", todoSchema);

describe("scrubAdminFields", () => {
  const todoAdmin: AdminConfig = {
    displayName: "Todos",
    excludeFields: ["secret"],
    hiddenFields: ["internalNote"],
    listFields: ["title"],
  };

  const userAdmin: AdminConfig = {
    displayName: "Users",
    excludeFields: ["hash", "salt"],
    listFields: ["email", "name"],
  };

  it("strips exclude and hidden fields at the top level", () => {
    const result = scrubAdminFields(
      {internalNote: "n", secret: "x", title: "Buy milk"},
      {admin: todoAdmin}
    );
    expect(result).toEqual({title: "Buy milk"});
  });

  it("scrubs nested arrays", () => {
    const result = scrubAdminFields(
      [
        {secret: "1", title: "a"},
        {internalNote: "2", title: "b"},
      ],
      {admin: todoAdmin}
    );
    expect(result).toEqual([{title: "a"}, {title: "b"}]);
  });

  it("scrubs populated refs using the referenced model admin config", () => {
    const populated = {
      ownerId: {
        _id: "507f1f77bcf86cd799439011",
        email: "a@b.com",
        hash: "hidden",
        name: "Alice",
        salt: "hidden",
      },
      title: "Task",
    };

    const result = scrubAdminFields(populated, {
      admin: todoAdmin,
      allModelAdmins: {ScrubUser: userAdmin},
      schema: Todo.schema,
    }) as {ownerId: Record<string, unknown>; title: string};

    expect(result.title).toBe("Task");
    expect(result.ownerId).toEqual({
      _id: "507f1f77bcf86cd799439011",
      email: "a@b.com",
      name: "Alice",
    });
  });

  it("returns unconfigured populated docs unchanged", () => {
    const populated = {
      ownerId: {_id: "507f1f77bcf86cd799439011", hash: "keep", name: "Alice"},
      title: "Task",
    };

    const result = scrubAdminFields(populated, {
      admin: todoAdmin,
      schema: Todo.schema,
    }) as {ownerId: Record<string, unknown>};

    expect(result.ownerId.hash).toBe("keep");
  });

  it("returns null and undefined unchanged", () => {
    expect(scrubAdminFields(null, {admin: todoAdmin})).toBeNull();
    expect(scrubAdminFields(undefined, {admin: todoAdmin})).toBeUndefined();
  });

  it("returns primitives unchanged", () => {
    expect(scrubAdminFields("Buy milk", {admin: todoAdmin})).toBe("Buy milk");
    expect(scrubAdminFields(7, {admin: todoAdmin})).toBe(7);
    expect(scrubAdminFields(false, {admin: todoAdmin})).toBe(false);
  });

  it("keeps null and undefined field values", () => {
    const result = scrubAdminFields(
      {completed: null, secret: "x", title: undefined},
      {admin: todoAdmin}
    );
    expect(result).toEqual({completed: null, title: undefined});
  });

  it("converts mongoose documents with toObject before scrubbing", () => {
    const doc = new Todo({title: "Task"});
    const result = scrubAdminFields(doc, {admin: todoAdmin}) as Record<string, unknown>;

    expect(result.title).toBe("Task");
    expect(result._id).toBeDefined();
  });

  it("scrubs each element of an array field", () => {
    const result = scrubAdminFields(
      {items: [{secret: "s", title: "a"}, "plain", 3], title: "Parent"},
      {admin: todoAdmin}
    ) as {items: unknown[]; title: string};

    expect(result.title).toBe("Parent");
    expect(result.items).toEqual([{title: "a"}, "plain", 3]);
  });

  it("leaves populated docs on paths without a ref unchanged", () => {
    const admin: AdminConfig = {
      displayName: "Todos",
      listFields: ["title"],
    };
    const result = scrubAdminFields(
      {title: {_id: "507f1f77bcf86cd799439011", hash: "keep"}},
      {admin, allModelAdmins: {ScrubUser: userAdmin}, schema: Todo.schema}
    ) as {title: Record<string, unknown>};

    expect(result.title.hash).toBe("keep");
  });

  it("leaves populated docs unchanged when no schema is provided", () => {
    const result = scrubAdminFields(
      {ownerId: {_id: "507f1f77bcf86cd799439011", hash: "keep"}},
      {admin: todoAdmin, allModelAdmins: {ScrubUser: userAdmin}}
    ) as {ownerId: Record<string, unknown>};

    expect(result.ownerId.hash).toBe("keep");
  });

  it("leaves unpopulated ref ids unchanged", () => {
    const result = scrubAdminFields(
      {ownerId: {_id: "507f1f77bcf86cd799439011"}, title: "Task"},
      {admin: todoAdmin, allModelAdmins: {ScrubUser: userAdmin}, schema: Todo.schema}
    ) as {ownerId: Record<string, unknown>};

    expect(result.ownerId).toEqual({_id: "507f1f77bcf86cd799439011"});
  });
});

describe("stripAdminBodyFields", () => {
  const admin: AdminConfig = {
    displayName: "Todos",
    excludeFields: ["role"],
    hiddenFields: ["internal"],
    listFields: ["title"],
    readonlyFields: ["slug"],
  };

  it("removes readonly, exclude, and hidden keys from objects", () => {
    const result = stripAdminBodyFields(
      {internal: "n", role: "admin", slug: "fixed", title: "x"},
      admin
    );
    expect<unknown>(result).toEqual({title: "x"});
  });

  it("strips keys from every object in an array body and leaves non-objects alone", () => {
    const result = stripAdminBodyFields(
      [
        {slug: "fixed", title: "a"},
        {internal: "n", title: "b"},
      ] as Record<string, unknown>[],
      admin
    );
    expect(result).toEqual([{title: "a"}, {title: "b"}]);
  });

  it("returns array entries that are not objects unchanged", () => {
    const body = [null, {role: "admin", title: "a"}] as unknown as Record<string, unknown>[];
    expect(stripAdminBodyFields(body, admin)).toEqual([null, {title: "a"}] as unknown as Record<
      string,
      unknown
    >[]);
  });

  it("returns null and undefined bodies unchanged", () => {
    expect(stripAdminBodyFields(null, admin)).toBeNull();
    expect(stripAdminBodyFields(undefined, admin)).toBeUndefined();
  });

  it("returns non-object bodies unchanged", () => {
    const body = "not-an-object" as unknown as Record<string, unknown>;
    expect(stripAdminBodyFields(body, admin)).toBe(body);
  });

  it("keeps an admin config without any strip lists intact", () => {
    const bareAdmin: AdminConfig = {displayName: "Todos", listFields: ["title"]};
    expect(stripAdminBodyFields({slug: "fixed", title: "x"}, bareAdmin)).toEqual({
      slug: "fixed",
      title: "x",
    });
  });
});
