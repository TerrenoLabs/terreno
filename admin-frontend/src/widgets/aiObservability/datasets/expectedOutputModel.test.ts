import {describe, it} from "bun:test";
import {assert} from "chai";
import {
  appendListItem,
  buildForm,
  emptyLike,
  type FormFieldNode,
  type FormGroupNode,
  type JsonSchema,
  labelFromKey,
  prepareFormValue,
  readPath,
  removeAtIndex,
  setAtPath,
} from "./expectedOutputModel";

const fieldAt = (node: FormGroupNode, label: string): FormFieldNode => {
  const found = node.children.find((child) => child.type === "field" && child.label === label);
  assert.exists(found);
  if (found?.type !== "field") {
    throw new Error(`Missing field ${label}`);
  }
  return found;
};

const CHAT_SAFETY_SCHEMA: JsonSchema = {
  properties: {
    crisis: {description: "Immediate danger to self", type: "boolean"},
    route: {
      description: "Where to send this message",
      enum: ["none", "988", "care-team"],
      type: "string",
    },
  },
  required: ["crisis", "route"],
  type: "object",
};

describe("expected output form", () => {
  it("labels a camelCase key as words", () => {
    assert.equal(labelFromKey("privacyLeak"), "Privacy Leak");
    assert.equal(labelFromKey("route", {title: "Routing"}), "Routing");
  });

  it("edits a string expected output as one text field", () => {
    const value = prepareFormValue(undefined, "Terreno ships one codebase.");
    const form = buildForm(undefined, value);
    assert.equal(form.type, "field");
    if (form.type !== "field") {
      return;
    }
    assert.equal(form.label, "Expected output");
    assert.equal(form.multiline, true);
    assert.equal(setAtPath(value, [], "One React Native codebase."), "One React Native codebase.");
  });

  it("builds checkboxes and a choice from the expected output schema", () => {
    const value = prepareFormValue(CHAT_SAFETY_SCHEMA, {route: "988"});
    const form = buildForm(CHAT_SAFETY_SCHEMA, value);
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    const crisis = fieldAt(form, "Crisis");
    const route = fieldAt(form, "Route");
    assert.equal(crisis.kind, "boolean");
    assert.equal(crisis.description, "Immediate danger to self");
    assert.equal(readPath(value, crisis.path), false);
    assert.deepEqual(route.enumValues, ["none", "988", "care-team"]);
    assert.equal(readPath(value, route.path), "988");
    const next = setAtPath(value, crisis.path, true);
    assert.deepEqual(next, {crisis: true, route: "988"});
  });

  it("builds fields from an object that has no schema", () => {
    const value = {answer: "yes", score: 2};
    const form = buildForm(undefined, value);
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.equal(fieldAt(form, "Answer").kind, "text");
    const score = fieldAt(form, "Score");
    assert.equal(score.kind, "number");
    assert.deepEqual(setAtPath(value, score.path, 3), {answer: "yes", score: 3});
  });

  it("adds and removes entries in a list", () => {
    const value = {notes: ["first"]};
    const form = buildForm(undefined, value);
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    const notes = form.children.find((child) => child.type === "list");
    assert.exists(notes);
    if (notes?.type !== "list") {
      return;
    }
    const added = appendListItem(value, notes.path, notes.itemSchema);
    assert.deepEqual(added, {notes: ["first", ""]});
    assert.deepEqual(removeAtIndex(added, notes.path, 0), {notes: [""]});
  });

  it("clears a sibling shape for a new item", () => {
    assert.deepEqual(emptyLike({ok: true, score: 1, text: "hello"}), {
      ok: false,
      score: null,
      text: "",
    });
  });
});
