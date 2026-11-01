> **findExactlyOne**\<`T`\>(`schema`): `void`

This adds a static method `Model.findExactlyOne` to the schema. This or findOneOrNone should replace `Model.findOne`
in most instances.
`Model.findOne` should only be used with a unique index, but that's not apparent from the docs. Otherwise you can wind
up with a random document that matches the query. The returns the one matching document, or throws an exception if
multiple or none are found.

## Type Parameters

### T

`T`

## Parameters

### schema

`Schema`\<`T`\>

Mongoose Schema

## Returns

`void`
