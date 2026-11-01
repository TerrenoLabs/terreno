# Admin Mobile Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On viewports below 768px, replace the admin shell’s fixed sidebar with a hamburger-triggered left slide-over drawer.

**Architecture:** Keep navigation content in one shared internal component. `AdminShell` uses `useWindowDimensions` to switch between desktop rail and mobile header + overlay drawer. Drawer closes on backdrop, close button, and nav selection.

**Tech Stack:** React Native / Expo, `@terreno/ui` (`Box`, `Heading`, `Text`, `IconButton`), bun test + `@testing-library/react-native`.

## Global Constraints

- Breakpoint: below 768px → mobile; 768px and above → desktop sidebar.
- Menu style: left slide-over drawer with dismissible backdrop.
- Accessibility: hamburger labeled "Open navigation menu"; close labeled "Close navigation menu".
- Do not change public `AdminShellProps` API unless required.
- Always support React Native Web.

---

### Task 1: Failing AdminShell responsive tests

**Files:**
- Create: `admin-frontend/src/AdminShell.test.tsx`

**Interfaces:**
- Consumes: `AdminShell` from `./AdminShell`; mocked `./useAdminConfig` and `expo-router`
- Produces: failing tests that assert desktop sidebar at ≥768, mobile header below 768, drawer open/close, nav closes drawer, a11y labels

- [ ] **Step 1: Write the failing test file**

Mock `useWindowDimensions` via a mutable width, mock `useAdminConfig` with a small config (Home + one model), mock `expo-router.router.push`. Assert:

1. width 1024 → `admin-shell-sidebar` present; hamburger absent
2. width 500 → sidebar absent; `admin-shell-menu-button` present with accessibilityLabel "Open navigation menu"
3. press menu → `admin-shell-drawer` and backdrop appear; close button has "Close navigation menu"
4. press backdrop / close → drawer gone
5. open drawer, press Home nav → `router.push` called and drawer closed

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd admin-frontend && bun test src/AdminShell.test.tsx`
Expected: FAIL (missing mobile UI / testIDs)

---

### Task 2: Implement responsive AdminShell

**Files:**
- Modify: `admin-frontend/src/AdminShell.tsx`
- Test: `admin-frontend/src/AdminShell.test.tsx`

**Interfaces:**
- Consumes: nav data from `useAdminConfig` (existing)
- Produces: `MOBILE_BREAKPOINT = 768`; shared sidebar body; mobile header; overlay drawer with backdrop

- [ ] **Step 1: Extract shared sidebar body**

Create an internal `AdminShellSidebarNav` that receives navigate callbacks, grouped models, scripts, screens, configurationPath, footer, sidebarVariant, and optional `onNavigate` that runs after each nav press (used to close the drawer).

- [ ] **Step 2: Wire responsive chrome**

```tsx
const MOBILE_BREAKPOINT = 768;
const {width} = useWindowDimensions();
const isMobileLayout = width < MOBILE_BREAKPOINT;
const [isNavOpen, setIsNavOpen] = useState(false);
```

Desktop: existing fixed 280px sidebar.
Mobile: compact header (`admin-shell-mobile-header`) with `IconButton` (`iconName="bars"`, testID `admin-shell-menu-button`) + "Admin" heading; main content full width.
When `isNavOpen`: absolute full-screen overlay (`admin-shell-drawer`) with backdrop (`admin-shell-drawer-backdrop`) and 280px panel containing close `IconButton` (`iconName="xmark"`, testID `admin-shell-drawer-close`) + shared nav. Close on backdrop, close button, and after navigate.

- [ ] **Step 3: Close drawer when resizing to desktop**

`useEffect` clears `isNavOpen` when `!isMobileLayout`.

- [ ] **Step 4: Run tests**

Run: `cd admin-frontend && bun test src/AdminShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Compile and lint**

Run: `cd admin-frontend && bun run compile && bun run lint`
Expected: clean

---

### Task 3: Manual UI verification

**Files:** none (runtime check in example-frontend admin)

- [ ] **Step 1:** With backend + `frontend:web` running, open `/admin` as `admin@example.com`
- [ ] **Step 2:** Narrow viewport below 768 → hamburger header, no fixed sidebar
- [ ] **Step 3:** Open drawer, navigate, confirm close; widen to ≥768 → sidebar returns
- [ ] **Step 4:** Capture screenshot evidence under `.devdata/artifacts/`
