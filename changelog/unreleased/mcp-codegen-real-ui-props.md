---
category: Fixed
---

- `terreno_generate_form_fields` now emits code that compiles against `@terreno/ui`: fields use `title`, `onChange`, and `errorText` (not `label`, `onChangeText`/`onChangeValue`, `error`), dates use `type` (not `mode`), `NumberField` gets `type="number"` and a string value, passwords use `TextField type="password"`, and required fields declare the `errors` state they read. A test type-checks the output against the `@terreno/ui` declarations so prop drift fails CI. The `terreno://docs/ui` form-field example uses the same props.
- `terreno_validate_model_schema` no longer reports "Missing TypeScript interfaces" when the model imports its `Document` type from `src/types/models/` or `src/modelInterfaces.ts`; it still reports a model with no `Document` type.
