> `const` **jwtTokenSource**: `AuthProvider`

The legacy JWT token source: the tokens `generateAuthSlice` stores. rtk uses this behavior
until an app calls `setTokenSource`; registering it explicitly changes nothing.
