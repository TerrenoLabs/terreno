> **githubUserPlugin**(`schema`): `void`

Plugin to add GitHub authentication fields to a user schema.
Apply this plugin to your User schema if you want to enable GitHub auth.

## Parameters

### schema

`Schema`\<`any`, `any`, `any`, `any`\>

## Returns

`void`

## Example

```typescript
import {githubUserPlugin} from "@terreno/api";

userSchema.plugin(githubUserPlugin);
```
