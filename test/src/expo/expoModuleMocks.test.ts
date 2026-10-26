import {describe, expect, it, mock} from "bun:test";

import {createExpoModuleMocks, VECTOR_ICON_FAMILIES} from "./expoModuleMocks";
import {registerExpoTestEnvironment} from "./registerExpoTestEnvironment";

registerExpoTestEnvironment({locale: "fr-CA", setProcessEnv: false, timeZone: "America/Toronto"});

const {createElement} = await import("react");
const {render} = await import("@testing-library/react-native");

type AnyModule = Record<string, unknown> & {default?: unknown};

const load = async (specifier: string): Promise<AnyModule> =>
  (await import(specifier)) as AnyModule;

describe("expo-router mock", () => {
  it("returns router handles and runs focus effects", async () => {
    const router = await load("expo-router");
    const useRouter = router.useRouter as () => Record<string, () => unknown>;
    expect(useRouter().canGoBack?.()).toBe(true);
    const effect = mock(() => {});
    (router.useFocusEffect as (effect?: () => void) => void)(effect);
    (router.useFocusEffect as (effect?: () => void) => void)();
    expect(effect).toHaveBeenCalledTimes(1);
    const navigation = (router.useNavigation as () => Record<string, () => unknown>)();
    expect(navigation.isFocused?.()).toBe(true);
    expect((router.usePathname as () => string)()).toBe("/");
  });

  it("renders navigators, screens, and links as host elements", async () => {
    const router = await load("expo-router");
    const Stack = router.Stack as ((props: object) => unknown) & {
      Screen: (props: object) => unknown;
    };
    const {getByTestId} = render(
      createElement(
        Stack as never,
        {testID: "stack"},
        createElement(Stack.Screen as never, {name: "index", testID: "screen"}),
        createElement(router.Link as never, {href: "/x", testID: "link"}),
        createElement(
          router.ThemeProvider as never,
          null,
          createElement(router.Slot as never, {testID: "slot"})
        )
      )
    );
    expect(getByTestId("stack")).toBeTruthy();
    expect(getByTestId("screen").props.name).toBe("index");
    expect(getByTestId("link").props.href).toBe("/x");
    expect(getByTestId("slot")).toBeTruthy();
  });
});

describe("expo module mocks", () => {
  it("reports locale and time zone from the options", async () => {
    const localization = await load("expo-localization");
    expect(
      (localization.getLocales as () => {languageCode: string; regionCode: string}[])()[0]
    ).toMatchObject({
      languageCode: "fr",
      regionCode: "CA",
    });
    expect(localization.timezone).toBe("America/Toronto");
  });

  it("defaults the linking scheme to exp and parses URLs", () => {
    const linking = createExpoModuleMocks()["expo-linking"]?.() as AnyModule;
    expect((linking.createURL as (path?: string) => string)()).toBe("exp://");
    expect((linking.parse as (url: string) => {path: string})("exp://a").path).toBe("exp://a");
  });

  it("stubs the native bridge", async () => {
    const core = await load("expo-modules-core");
    expect((core.requireNativeModule as (name: string) => unknown)("Anything")).toEqual({});
    expect((core.requireOptionalNativeModule as (name: string) => unknown)("Anything")).toBeNull();
    const usePermission = (core.createPermissionHook as () => () => [{granted: boolean}])();
    expect(usePermission()[0].granted).toBe(true);
    const Platform = core.Platform as {select: (spec: object) => unknown};
    expect(Platform.select({default: "d", ios: "i"})).toBe("i");
    expect(Platform.select({default: "d"})).toBe("d");
    expect((core.registerWebModule as <T>(value: T) => T)("module")).toBe("module");
    expect(
      (core.useReleasingSharedObject as (factory: () => string) => string)(() => "shared")
    ).toBe("shared");
    const error = new (
      core.UnavailabilityError as new (
        moduleName: string,
        property: string
      ) => Error & {code: string}
    )("ExpoThing", "method");
    expect(error.code).toBe("ERR_UNAVAILABLE");
    for (const name of ["NativeModule", "SharedObject", "SharedRef", "EventEmitter"]) {
      const instance = new (core[name] as new () => {addListener: () => {remove: () => void}})();
      instance.addListener().remove();
    }
    const expo = await load("expo");
    expect((expo.isRunningInExpoGo as () => boolean)()).toBe(false);
  });

  it("renders vector icons as host elements with their props", async () => {
    const icons = await load("@expo/vector-icons");
    const {default: FontAwesome6} = await load("@expo/vector-icons/FontAwesome6");
    expect(FontAwesome6).toBe(icons.FontAwesome6);
    const {getByTestId} = render(
      createElement(FontAwesome6 as never, {name: "check", testID: "icon"})
    );
    expect(getByTestId("icon").props.name).toBe("check");
    expect(VECTOR_ICON_FAMILIES).toContain("Ionicons");
  });

  it("gives every device API a resolved, non-native answer", async () => {
    const fileSystem = await load("expo-file-system");
    const File = fileSystem.File as new (...parts: string[]) => {uri: string};
    expect(new File("file:///docs", "a.txt").uri).toBe("file:///docs/a.txt");
    expect(((await load("expo-device")) as {osName: string}).osName).toBe("iOS");
    const androidDevice = createExpoModuleMocks({platform: "android"})["expo-device"]?.() as {
      osName: string;
    };
    const webDevice = createExpoModuleMocks({platform: "web"})["expo-device"]?.() as {
      osName: string;
    };
    expect([androidDevice.osName, webDevice.osName]).toEqual(["Android", "Web"]);
    const constants = (await load("expo-constants")).default as {expoConfig: {slug: string}};
    expect(constants.expoConfig.slug).toBe("test");
    const font = await load("expo-font");
    expect((font.useFonts as () => unknown)()).toEqual([true, null]);
  });

  it("builds a factory for every module", () => {
    for (const [specifier, factory] of Object.entries(createExpoModuleMocks())) {
      expect(factory(), specifier).toBeDefined();
    }
  });
});
