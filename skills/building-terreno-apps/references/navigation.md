# Navigation — Terreno Apps

Terreno apps use Expo Router. Use Expo Router's public documentation for low-level APIs
such as `Link`, `Stack.Screen`, modals, and form sheets. This reference covers
Terreno-specific navigation patterns.

## Auth flow

1. Root `_layout.tsx` reads `useSession()` from `@terreno/syncdb/auth`.
2. Unauthenticated users redirect to `/login`.
3. Login calls `betterAuthClient.signIn.email`, then `useSession().refresh()`.
4. Once `userId` is set, the root layout starts syncdb and redirects to `/(tabs)` or the
   intended deep link.

```tsx
import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Page, TextField} from "@terreno/ui";
import {betterAuthClient} from "@/lib/betterAuth";

const LoginScreen: React.FC = () => {
  const {refresh} = useSession();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>();

  const handleLogin = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    const result = await betterAuthClient.signIn.email({email, password});
    setIsLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Login failed");
      return;
    }
    await refresh();
  }, [email, password, refresh]);

  return (
    <Page title="Login" scroll>
      <Box gap={3} padding={4}>
        <TextField title="Email" value={email} onChange={setEmail} type="email" />
        <TextField title="Password" value={password} onChange={setPassword} type="password" errorText={error} />
        <Button text="Sign in" onClick={handleLogin} loading={isLoading} fullWidth />
      </Box>
    </Page>
  );
};
```

## Tabs

Use Expo Router tab groups. Set tab icons via `@expo/vector-icons` or FontAwesome through `@terreno/ui` `Icon`:

```tsx
import {Tabs} from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";

const TabLayout: React.FC = () => {
  return (
    <Tabs screenOptions={{headerShown: false}}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Todos",
          tabBarIcon: ({color}) => <FontAwesome name="list" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({color}) => <FontAwesome name="user" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
};
```

## Modals

Use Expo Router modal presentation for simple overlays:

```tsx
// app/_layout.tsx
<Stack>
  <Stack.Screen name="(tabs)" options={{headerShown: false}} />
  <Stack.Screen name="modal" options={{presentation: "modal"}} />
</Stack>
```

For confirmation dialogs and action sheets, prefer `@terreno/ui` `Modal` or `ActionSheet` — they render correctly on web and native.

## Deep linking

Configure `scheme` in `app.json`. `@terreno/syncdb/config` resolves API base URLs from `expo.extra.BASE_URL` or `EXPO_PUBLIC_API_URL` — keep deep link schemes separate from API URLs.

## Programmatic navigation

```tsx
import {useRouter} from "expo-router";

const router = useRouter();
router.push(`/admin/${modelName}`);
router.back();
```

Use `Link` from `expo-router` for declarative navigation when possible.
