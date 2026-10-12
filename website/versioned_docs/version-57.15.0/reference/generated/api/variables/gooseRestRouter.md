> `const` **gooseRestRouter**: \{\<`T`\>(`path`, `model`, `options`): [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md); \<`T`\>(`model`, `options`): `Router`; \} = `modelRouter`

## Call Signature

> \<`T`\>(`path`, `model`, `options`): [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md)

Create a set of CRUD routes given a Mongoose model and configuration options.

When called with a path as the first argument, returns a `ModelRouterRegistration` that can be
passed to `TerrenoApp.register()`.

### Type Parameters

#### T

`T`

### Parameters

#### path

`string`

#### model

`ModelLike`\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

### Returns

[`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md)

### Example

```ts
// Traditional usage (returns express.Router):
router.use("/todos", modelRouter(Todo, options));

// Registration usage (returns ModelRouterRegistration):
const todoRouter = modelRouter("/todos", Todo, options);
app.register(todoRouter);
```

## Call Signature

> \<`T`\>(`model`, `options`): `Router`

Create a set of CRUD routes given a Mongoose model and configuration options.

When called with a path as the first argument, returns a `ModelRouterRegistration` that can be
passed to `TerrenoApp.register()`.

### Type Parameters

#### T

`T`

### Parameters

#### model

`ModelLike`\<`T`\>

#### options

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

### Returns

`Router`

### Example

```ts
// Traditional usage (returns express.Router):
router.use("/todos", modelRouter(Todo, options));

// Registration usage (returns ModelRouterRegistration):
const todoRouter = modelRouter("/todos", Todo, options);
app.register(todoRouter);
```
