import {describe, it} from "bun:test";
import {assert} from "chai";
import {
  appendListItem,
  buildForm,
  emptyLike,
  type FormFieldNode,
  type FormGroupNode,
  type JsonSchema,
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
    const schema: JsonSchema = {
      properties: {
        privacyLeak: {type: "boolean"},
        route: {title: "Routing", type: "string"},
      },
      type: "object",
    };
    const form = buildForm(schema, prepareFormValue(schema, {}));
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.exists(fieldAt(form, "Privacy Leak"));
    assert.exists(fieldAt(form, "Routing"));
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

describe("expected output model edge cases", () => {
  it("reads the first non-null type from a type list", () => {
    const form = buildForm({type: ["null", "number"]}, 3);
    assert.equal(form.type, "field");
    if (form.type !== "field") {
      return;
    }
    assert.equal(form.kind, "number");
  });

  it("keeps the raw key as the label when the key has no letters to show", () => {
    const schema: JsonSchema = {properties: {_: {type: "string"}}, type: "object"};
    const form = buildForm(schema, {_: "x"});
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.exists(fieldAt(form, "_"));
  });

  it("reads and writes through primitives and arrays without throwing", () => {
    assert.isUndefined(readPath("text", ["length"]));
    assert.equal(readPath("kept", []), "kept");
    assert.deepEqual(setAtPath({}, [0], "a"), ["a"]);
    assert.deepEqual(setAtPath([1], ["key"], 2), {key: 2});
    assert.deepEqual(removeAtIndex({tags: "x"}, ["tags"], 0), {tags: []});
  });

  it("uses the value as is when there is no schema", () => {
    assert.equal(prepareFormValue(undefined, undefined), "");
    assert.equal(prepareFormValue(undefined, 5), 5);
  });

  it("fills schema types into array items and scalar values", () => {
    const listSchema: JsonSchema = {items: {type: "number"}, type: "array"};
    assert.deepEqual(prepareFormValue(listSchema, [1, "x"]), [1, null]);
    assert.deepEqual(prepareFormValue(listSchema, "not a list"), []);

    assert.equal(prepareFormValue({type: "boolean"}, "yes"), false);
    assert.equal(prepareFormValue({type: "boolean"}, true), true);
    assert.equal(prepareFormValue({type: "number"}, "2"), null);
    assert.equal(prepareFormValue({type: "number"}, 2), 2);
    assert.equal(prepareFormValue({enum: ["a"], type: "string"}, 5), "");
    assert.equal(prepareFormValue({enum: ["a"], type: "string"}, "a"), "a");
    assert.equal(prepareFormValue({type: "string"}, "abc"), "abc");
    assert.equal(prepareFormValue({type: "string"}, null), "");
    assert.equal(prepareFormValue({type: "string"}, 7), 7);
  });

  it("builds an object from the schema when the value is not an object", () => {
    const schema: JsonSchema = {
      properties: {name: {type: "string"}},
      type: "object",
    };
    assert.deepEqual(prepareFormValue(schema, "nope"), {name: ""});
  });

  it("starts a new list entry with blank values shaped like the item schema", () => {
    const itemSchema: JsonSchema = {
      properties: {
        flag: {type: "boolean"},
        list: {type: "array"},
        name: {type: "string"},
        score: {type: "integer"},
      },
      type: "object",
    };
    const added = appendListItem({rows: []}, ["rows"], itemSchema);
    assert.deepEqual(added, {rows: [{flag: false, list: [], name: "", score: null}]});
    assert.deepEqual(appendListItem({rows: []}, ["rows"], {type: "object"}), {rows: [{}]});
    assert.deepEqual(appendListItem({}, ["rows"]), {rows: [""]});
  });

  it("copies the shape of the last list entry when adding one", () => {
    const value = {rows: [{name: "a", score: 3}]};
    assert.deepEqual(appendListItem(value, ["rows"]), {
      rows: [
        {name: "a", score: 3},
        {name: "", score: null},
      ],
    });
  });

  it("clears arrays and primitives in a sibling shape", () => {
    assert.deepEqual(emptyLike(null), "");
    assert.deepEqual(emptyLike([]), []);
    assert.deepEqual(emptyLike(["filled"]), [""]);
    assert.deepEqual(emptyLike({flag: true, nested: [1]}), {flag: false, nested: [null]});
  });

  it("marks long and multi-line text as multiline", () => {
    const schema: JsonSchema = {
      properties: {long: {type: "string"}, note: {type: "string"}},
      type: "object",
    };
    const form = buildForm(schema, {long: "y".repeat(81), note: "line\nbreak"});
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.isTrue(fieldAt(form, "Long").multiline);
    assert.isTrue(fieldAt(form, "Note").multiline);
    const short = buildForm(schema, {long: "short", note: "also short"});
    if (short.type !== "group") {
      return;
    }
    assert.isFalse(fieldAt(short, "Long").multiline);
  });

  it("keeps a declared string field as text when the stored value is a number or boolean", () => {
    const schema: JsonSchema = {
      properties: {code: {type: "string"}, flag: {type: "string"}},
      type: "object",
    };
    const value = prepareFormValue(schema, {code: 42, flag: true});
    assert.deepEqual(value, {code: "42", flag: "true"});
    const form = buildForm(schema, value);
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.equal(fieldAt(form, "Code").kind, "text");
    assert.equal(fieldAt(form, "Flag").kind, "text");
  });

  it("infers numbers and booleans from values when the schema has no type", () => {
    const schema: JsonSchema = {properties: {flag: {}, n: {}}, type: "object"};
    const form = buildForm(schema, {flag: true, n: 4});
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.equal(fieldAt(form, "Flag").kind, "boolean");
    assert.equal(fieldAt(form, "N").kind, "number");
  });

  it("labels items in an untyped list and a field with no label", () => {
    const list = buildForm({type: "array"}, [1, 2]);
    assert.equal(list.type, "list");
    if (list.type !== "list") {
      return;
    }
    assert.equal(list.children.length, 2);
    const untitled = buildForm(undefined, undefined);
    assert.equal(untitled.type, "field");
    if (untitled.type !== "field") {
      return;
    }
    assert.equal(untitled.label, "Expected output");
  });

  it("keeps keys the schema does not declare as extra fields", () => {
    const schema: JsonSchema = {properties: {a: {type: "string"}}, type: "object"};
    const form = buildForm(schema, {a: "1", extra: "2"});
    assert.equal(form.type, "group");
    if (form.type !== "group") {
      return;
    }
    assert.exists(fieldAt(form, "Extra"));
  });
});
