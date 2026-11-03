> **generateBetterAuthSlice**(`config`): `object`

Generates a Better Auth Redux slice with session management.

## Parameters

### config

[`GenerateBetterAuthSliceConfig`](../interfaces/GenerateBetterAuthSliceConfig.md)

## Returns

### actions

> **actions**: `CaseReducerActions`\<\{ `clearSession`: (`state`) => `void`; `logout`: (`state`) => `void`; `setError`: (`state`, `action`) => `void`; `setLoading`: (`state`, `action`) => `void`; `setSession`: (`state`, `action`) => `void`; \}, `"betterAuth"`\> = `betterAuthSlice.actions`

Actions for the Better Auth slice.

### authClient

> **authClient**: [`BetterAuthClientInterface`](../interfaces/BetterAuthClientInterface.md)

The Better Auth client instance.

### middleware

> **middleware**: `ListenerMiddleware`\<`unknown`, `ThunkDispatch`\<`unknown`, `unknown`, `UnknownAction`\>, `unknown`\>[]

Middleware for handling Better Auth side effects.

### reducer

> **reducer**: `Reducer`\<[`BetterAuthState`](../interfaces/BetterAuthState.md)\> = `betterAuthSlice.reducer`

The reducer for the Better Auth slice.

### slice

> **slice**: `Slice`\<[`BetterAuthState`](../interfaces/BetterAuthState.md), \{ `clearSession`: (`state`) => `void`; `logout`: (`state`) => `void`; `setError`: (`state`, `action`) => `void`; `setLoading`: (`state`, `action`) => `void`; `setSession`: (`state`, `action`) => `void`; \}, `"betterAuth"`, `"betterAuth"`, `SliceSelectors`\<[`BetterAuthState`](../interfaces/BetterAuthState.md)\>\> = `betterAuthSlice`

The Better Auth Redux slice.

### syncSession

> **syncSession**: (`dispatch`) => `Promise`\<`void`\>

Function to sync session state from Better Auth to Redux.

Syncs the session state from Better Auth to Redux.
Call this on app startup and periodically to keep state in sync.

#### Parameters

##### dispatch

(`action`) => `void`

#### Returns

`Promise`\<`void`\>

## Example

```typescript
const authClient = createBetterAuthClient({
  baseURL: "http://localhost:3000",
  scheme: "terreno",
});

const betterAuthSlice = generateBetterAuthSlice({ authClient });

// Add to your store
const store = configureStore({
  reducer: {
    betterAuth: betterAuthSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(betterAuthSlice.middleware),
});

// Use in components
const isAuthenticated = useSelector(selectBetterAuthIsAuthenticated);
const user = useSelector(selectBetterAuthUser);

// Trigger logout
dispatch(betterAuthSlice.actions.logout());
```
