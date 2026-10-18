# @terreno/rtk Documentation (legacy)

> **Deprecated for data synchronization** as of `56.0.0`. Use `@terreno/syncdb` for collection CRUD. This resource documents RTK for OpenAPI SDK codegen, Better Auth session Redux, feature flags, and sockets during the support window. See [migrate-rtk-to-syncdb.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/migrate-rtk-to-syncdb.md).

Redux Toolkit Query utilities for frontends connecting to @terreno/api backends.

## Key Exports

- `emptyApi` - Base RTK Query API configured with axios
- `authSlice` - Redux slice for auth state
- `generateProfileEndpoints` - Auth endpoint builder
- Token utilities: `getTokenExpirationTimes()`, `getFriendlyExpirationInfo()`, `getAuthToken()`

## Setup

### Store Configuration

```typescript
import { configureStore } from "@reduxjs/toolkit";
import { emptyApi, authSlice } from "@terreno/rtk";
import { openApiSdk } from "./openApiSdk";

export const store = configureStore({
  reducer: {
    [openApiSdk.reducerPath]: openApiSdk.reducer,
    auth: authSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(openApiSdk.middleware),
});
```

### SDK Generation

The SDK is auto-generated from your backend's OpenAPI spec:

```typescript
// openApiSdk.ts - AUTO-GENERATED, DO NOT EDIT
import { emptyApi } from "@terreno/rtk";

export const openApiSdk = emptyApi.injectEndpoints({
  endpoints: (build) => ({
    getUsers: build.query<User[], GetUsersParams>({
      query: (params) => ({ url: "/users", params }),
    }),
    createUser: build.mutation<User, CreateUserBody>({
      query: (body) => ({ url: "/users", method: "POST", body }),
    }),
  }),
});

export const { useGetUsersQuery, useCreateUserMutation } = openApiSdk;
```

## Using the SDK

```typescript
import { useGetUsersQuery, useCreateUserMutation } from "@/store/openApiSdk";

const UserList = () => {
  const { data: users, isLoading, error } = useGetUsersQuery({ limit: 10 });
  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();

  const handleCreate = async () => {
    try {
      const newUser = await createUser({ name: "John", email: "john@example.com" }).unwrap();
      console.info("Created user:", newUser);
    } catch (err) {
      console.error("Failed to create user:", err);
    }
  };

  if (isLoading) return <Text>Loading...</Text>;
  if (error) return <Text>Error loading users</Text>;

  return (
    <Box>
      {users?.map((user) => (
        <Text key={user.id}>{user.name}</Text>
      ))}
      <Button text="Add User" onClick={handleCreate} loading={isCreating} />
    </Box>
  );
};
```

## Authentication

### Login

```typescript
import { useEmailLoginMutation } from "@/store/openApiSdk";
import { useAppDispatch } from "@/store/index";
import { authSlice } from "@terreno/rtk";

const LoginScreen = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailLogin, { isLoading, error }] = useEmailLoginMutation();
  const dispatch = useAppDispatch();

  const handleLogin = async () => {
    try {
      const result = await emailLogin({ email, password }).unwrap();
      // Auth state is automatically updated
    } catch (err) {
      console.error("Login failed:", err);
    }
  };

  return (
    <Box padding={4} gap={3}>
      <EmailField label="Email" value={email} onChangeText={setEmail} />
      <PasswordField label="Password" value={password} onChangeText={setPassword} />
      <Button text="Login" onClick={handleLogin} loading={isLoading} />
    </Box>
  );
};
```

### Auth State

```typescript
import { useAppSelector } from "@/store/appState";

const Component = () => {
  const userId = useAppSelector((state) => state.auth.userId);
  const isAuthenticated = !!userId;

  // ...
};
```

### Logout

```typescript
import { LOGOUT_ACTION_TYPE } from "@terreno/rtk";

const handleLogout = () => {
  dispatch({ type: LOGOUT_ACTION_TYPE });
};
```

## Token Management

Tokens are automatically managed:
- Stored in `expo-secure-store` (mobile) or AsyncStorage (web)
- Auto-refresh with exponential backoff
- Mutex-protected to prevent race conditions

```typescript
import { getAuthToken, getTokenExpirationTimes } from "@terreno/rtk";

// Get current token
const token = await getAuthToken();

// Check expiration
const { accessTokenExpiry, refreshTokenExpiry } = getTokenExpirationTimes(token);
```

## Platform Detection

```typescript
import { IsWeb, IsNative } from "@terreno/rtk";

if (IsWeb) {
  // Web-specific code
}

if (IsNative) {
  // Mobile-specific code
}
```

## Best Practices

1. **Never use axios directly** - Always use generated SDK hooks
2. **Don't modify generated SDK** - It's auto-generated from OpenAPI spec
3. **Use .unwrap()** for mutations to get the result or throw error
4. **Handle loading and error states** in your UI
5. **Use TypeScript** - The SDK provides full type safety
