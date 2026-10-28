> **upsertPlugin**\<`T`\>(`schema`): `void`

This adds a static method `Model.upsert` to the schema. This method will either update an existing document
that matches the conditions or create a new document if none exists. It throws an error if multiple documents
match the conditions to prevent ambiguous updates.

## Type Parameters

### T

`T`

## Parameters

### schema

`Schema`\<`any`, `any`, `any`, `any`\>

Mongoose Schema

## Returns

`void`
