# Admin Mobile Navigation Design

## Goal

Make the admin shell usable on narrow devices by replacing its fixed 280px sidebar with a hamburger-triggered navigation drawer below 768px.

## Responsive behavior

- At widths of 768px and above, preserve the existing sidebar and content layout.
- Below 768px, hide the fixed sidebar and show a compact header with an accessible hamburger button and the Admin label.
- Opening the hamburger displays the same grouped navigation in a left slide-over drawer above the page.
- A backdrop covers the remaining page and dismisses the drawer when pressed.
- The drawer also closes from its close button and after any navigation item is selected.

## Component structure

Extract the sidebar body into a shared internal component so desktop and mobile render the same links, groups, configuration entry, and footer. `AdminShell` owns responsive width detection and drawer open state. The existing main content, top bar, breadcrumbs, and header actions remain unchanged apart from the added mobile header.

## Accessibility

- The hamburger button has an "Open navigation menu" label.
- The drawer close button has a "Close navigation menu" label.
- Backdrop dismissal is available in addition to the explicit close button.
- Existing navigation labels and hints remain intact.

## Testing

Add focused `AdminShell` tests covering:

- Desktop sidebar rendering at 768px and above.
- Mobile header rendering below 768px.
- Opening and closing the drawer.
- Closing after selecting a navigation item.
- Hamburger and close-button accessibility labels.

Run the admin frontend test suite, compile, lint, and responsive UI verification.
