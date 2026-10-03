# @terreno/ui

React Native UI component library for Terreno apps (iOS, Android, and web).

[![Netlify Status](https://api.netlify.com/api/v1/badges/ffd05ee5-fbcf-417e-8455-45ea15447361/deploy-status)](https://app.netlify.com/sites/terreno-ui/deploys)

## Why Terreno UI?
Terreno UI provides a consistent UI for React Native and React Native Web, 
support iOS, Android, and Web all in one simple repo. It has
theming support and is primarily designed for Expo. It provides an abstraction
layer over React Native components, making it easier to build responsive
applications that work across all platforms.
For example, instead of using ```<div>``` and ```<View>```, you use ```<Box>``` , which 
translates to a flexbox-first layout system.

Ideal for designers and developers who value clarity, Terreno UI offers a 
framework for efficient and harmonious designs. Our vision extends beyond a 
User Interface Library to a User Experience Library, including common UX 
patterns like login flows, allowing you to focus on unique aspects of your app.

Join us in embracing a design philosophy that prioritizes clarity and 
coherence. With Terreno UI, build stunning applications with seamless 
user experiences across all three platforms is a breeze.

## Our Philosophy
Terreno UI streamlines design by reducing unnecessary choices, allowing you to 
create beautiful, functional interfaces without distraction. For example, 
buttons come in a limited set of colors, with no options for custom colors,
ensuring consistency that you decide upfront, rather than with each new 
feature.

## Consistent Layouts
Our layout system, built around the Box component and other layout elements, 
ensures flexible yet uniform design structures. It's is flexbox-first across
iOS, Android, and Web, making it easy to create responsive designs that work
across all platforms.

## Separated Interface Elements
Terreno UI and interaction components follow a set of guidelines for consistency. 
For instance, you can't add a margin to Text. Instead, you wrap the Text in a 
Box and add the margin to the Box, maintaining a clean and predictable design
language that separates layout elements from interface and interaction elements.

## Accessibility
Accessibility is a core principle of Terreno UI. Our components are designed to 
be fully accessible out of the box, following best practices to ensure that 
all users, including those with disabilities, have a seamless experience. Our
lint rules and required accessibility props will help you build more accessible
applications by default.

## Developer Experience
Terreno UI is designed with a TypeScript-first approach, prioritizing an 
excellent developer experience. Our consistent API across all components 
ensures ease of learning and use. This makes it simple to design screens 
that work seamlessly across web and mobile, with built-in support for 
differentiating based on screen size and format.

Check out the demo app for easily seeing how the UIs work in iOS/Android/Web 
in apps/demo.

You can see the [web demo here](https://terreno-demo.netlify.app).

## Install

```bash
bun add @terreno/ui
```

# Usage

You must wrap your app in a TerrenoProvider to use the theme, Toasts, and other features.

    import { TerrenoProvider } from '@terreno/ui';

    const AppRoot = (): ReactElement => {
        return (
            <SafeAreaProvider>
                <TerrenoProvider>
                    <App />
                </TerrenoProvider>
            </SafeAreaProvider>
        );
    };

## Dev

    # Install dependencies
    bun install

    # Initial build (including type generation)
    bun compile

    # Build the UI continuously
    bun dev

    # In a separate window, run one of the following to run the demo app:
    bun web
    bun ios
    bun android
    

## Dev with other projects

If you need to test your changes in another project, you can use this handy bash function:

    # sync ui to different app
    syncui() {
        cd <PATH>/terreno/ui && bun run build && rsync -avp <PATH>/terreno/ui/dist/* <PATH>/app/node_modules/@terreno/ui/dist/
    }

Update the paths to match your project directories. This will build and pack up @terreno/ui like it is being
send to NPM, then install it from the created tarball in your app. `bun link` is also an option but React
Native requires extra configuration to support symlinks.

## Releasing

Releases are typically done after each pull request is merged to keep the package up-to-date.

### Publishing a new version

1. Go to the [GitHub releases page](https://github.com/TerrenoLabs/terreno/releases)
2. Click "Draft a new release"
3. Create a new tag with a version number (usually a minor version bump, e.g., `1.11.0`)
4. Use the "Generate release notes" button to auto-populate the description
5. Click "Publish release"

### What happens automatically

After publishing the release, the following happens automatically via `.github/workflows/ui-publish.yml`:

1. The package version in `package.json` is updated to match your release tag
2. The package is built and published to NPM (takes a couple of minutes)
3. A pull request is automatically created with the version bump

### Approving the version bump PR

After the release is published, you'll get a PR that updates the version in `package.json`. You can approve and merge this PR yourself.

### Using the new version in your app

To use your newly released version of @terreno/ui in your app:

1. Navigate to your repository
2. Update the `@terreno/ui` version in `app/package.json`:
   ```json
   "@terreno/ui: "1.11.0"
   ```
3. Run `bun install` in the `app/` directory
4. Create a PR with this change (requires team member approval)


## Upgrading dependencies

To upgrade to the latest Expo and upgrade the related dependencies:

    bun update

This will upgrade Expo, upgrade Expo packages, sync the changes from apps/demo to packages/ui,
and update bun.lock.

## Test IDs (E2E / component tests)

All public `@terreno/ui` components accept an optional `testID` prop for targeting in Playwright, Detox, or `@testing-library/react-native`.

- **Root id:** `testID="login.email"` sets the primary interactive element (RN `testID`, which maps to `data-testid` on web).
- **Compound fields** (`TextField`, `SelectField`, `DateTimeField`, etc.): optional `testIDs` overrides sub-elements; otherwise defaults use dot suffixes:
  - `{testID}.label`, `{testID}` (input), `{testID}.error`, `{testID}.helper`
- **Modal:** `testIDs={{ primaryButton: "confirm.ok", secondaryButton: "confirm.cancel" }}` or defaults `{testID}.primary`, `{testID}.secondary`, `{testID}.dismiss`.
- **DataTable:** `testIDs={{ root, header, body, pagination, row }}`; row cells use `resolveDataTableRowTestID(testIDs.row, rowKey)`. Pass `getRowTestID={(row, index) => rowId}` for stable ids when sorting or paginating.

Helpers exported from `@terreno/ui`:

```typescript
import {
  resolveTestID,
  resolveFieldTestIDsFromProps,
  resolveModalTestIDsFromProps,
  resolveDataTableTestIDsFromProps,
  resolveDataTableRowTestID,
  toTestProps,
  toDomTestProps,
  toPlatformTestProps,
} from "@terreno/ui";
```

Do not rely on internal CSS class names or DOM structure for tests.

## Documentation

Full API reference: [docs/reference/ui.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/ui.md)

Agent asks in `GPTChat` (`AskCard`, `SimpleAskCard`): [Add agent asks to a chat](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/agent-ui-asks.md)

Live example: [Terreno UI demo](https://terreno-demo.netlify.app)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
