/**
 * Block documents for the BlocksPlayground. Layout, Invalid, and Sunday roast match the golden
 * fixtures; each block-type preset shows one block type (every chart kind, every callout status,
 * every action kind); "All blocks" shows one of each. `BlocksPlayground.test.tsx` checks that every
 * block type in `@terreno/blocks` appears in some preset and that every preset validates.
 * Photos are `file:` ids that `resolveBlocksPhoto` turns into the bundled demo photos.
 */

/** Callbacks the playground runs on the device. `exportDataset` only shows a toast. */
export const PLAYGROUND_HOST_ACTIONS = [
  "exportDataset",
  "scaleStepper",
  "toggleChecklist",
] as const;

const LAYOUT = `v: 1
blocks:
  - type: heading
    size: lg
    text: Signups this quarter
  - type: text
    markdown: Signups grew **12%** quarter over quarter.
  - type: metric
    label: Total
    value: "403"
    delta: "+12%"
    trend: up
`;

const INVALID = `v: 1
blocks:
  - type: heading
    text: Hello
    color: primary
`;

// The Sunday roast golden fixture (blocks/src/fixtures/golden/sunday-roast.yaml) with bundled
// file: photos in place of its https photos, so it renders offline without imageHosts.
const ROAST = `v: 1
datasets:
  lamb_by_guests:
    columns:
      - {name: guests, type: number}
      - {name: bone_in_lamb, type: string}
      - {name: potatoes, type: string}
    rows:
      - [4, "3–4 lb", "2 lb"]
      - [6, "4–5 lb", "3 lb"]
      - [8, "5–6 lb", "4 lb"]
      - [10, "6–7½ lb", "5 lb"]
blocks:
  - type: heading
    size: lg
    text: Your Sunday lamb roast 🍷
  - type: gallery
    id: roast_photos
    images:
      - {src: "file:roast-lamb", alt: Roast lamb}
      - {src: "file:roast-potatoes", alt: Crispy roast potatoes}
      - {src: "file:roast-plate", alt: Sunday roast inspiration}
  - type: text
    markdown: |-
      I'm thinking a proper British-inspired Sunday roast with a little Mediterranean flair. Crispy potatoes, tender rosemary and garlic lamb, seasonal vegetables, and a delicious gravy. The kind of meal where everyone lingers at the table.

      Since you haven't finalized your guest list, we'll build a flexible menu that scales with your headcount.
  - type: card
    id: dinner_plan
    eyebrow: Your dinner plan
    title: Sunday roast with friends
    children:
      - type: text
        markdown: |-
          - **Style:** Cozy, generous, slightly elevated
          - **Prep:** Most work happens before guests arrive
          - **Cooking:** Approximately 2 to 3 hours, depending on the lamb
          - **Serving:** Family-style, with everything in the middle of the table
  - type: heading
    size: md
    text: 1. The menu
  - type: list
    id: menu
    items:
      - title: "The centerpiece: Rosemary and garlic roast lamb"
        text: A classic leg of lamb with lemon, garlic, rosemary and olive oil. Serve carved with homemade gravy and mint sauce.
        image: {src: "file:roast-lamb", alt: "The centerpiece: Rosemary and garlic roast lamb"}
      - title: "The essential: Extra-crispy roast potatoes"
        text: Parboiled, shaken to create fluffy edges and roasted until golden. Nonnegotiable!
        image: {src: "file:roast-potatoes", alt: "The essential: Extra-crispy roast potatoes"}
      - title: Honey-roasted carrots and parsnips
        text: Tossed with olive oil, honey and fresh thyme.
        image: {src: "file:roasted-carrots", alt: Honey-roasted carrots and parsnips}
      - title: Lemony greens
        text: Tenderstem broccoli with toasted almonds and lemon zest. Something fresh to balance the rich lamb.
        image: {src: "file:greens", alt: Lemony greens}
      - title: "Dessert: Warm apple crumble"
        text: Serve with vanilla ice cream. Make it the day before and reheat while you're eating.
        image: {src: "file:apple-crumble", alt: "Dessert: Warm apple crumble"}
  - type: heading
    size: md
    text: 2. How much should you buy?
  - type: text
    markdown: Adjust the guest count below to calculate your shopping quantities. This assumes everyone eats lamb and includes you in the total.
  - type: card
    id: shopping
    children:
      - type: stepper
        id: guests
        label: Number of people
        unit: People
        value: 5
        min: 1
        max: 20
        callback: {name: scaleStepper}
        itemsTitle: Your shopping quantities
        items:
          - {label: Bone-in leg of lamb, amount: 2, unit: kg, decimals: 1}
          - {label: Potatoes, amount: 1500, unit: g}
          - {label: Carrots, amount: 8, round: up}
          - {label: Parsnips, amount: 5, round: up}
          - {label: Tenderstem broccoli, amount: 625, unit: g}
          - {label: Apples for crumble, amount: 4, round: up}
        note: Generous portions, with a little extra. Lamb weight includes the bone. Ask your butcher for help selecting the closest available size.
      - type: actions
        id: shopping_actions
        elements:
          - type: button
            id: copy_shopping_list
            text: Copy shopping list
            variant: outline
            iconName: copy
            action: {kind: copy, target: guests}
  - type: text
    markdown: Also pick up garlic, rosemary, thyme, lemons, honey, almonds, olive oil, gravy ingredients, mint sauce, crumble topping and vanilla ice cream.
  - type: table
    id: lamb_table
    title: How much lamb?
    data: lamb_by_guests
  - type: heading
    size: md
    text: 3. Your Sunday cooking timeline
  - type: text
    markdown: Let's assume you're eating at **5 PM.** This example uses a roughly 2.4 kg bone-in leg of lamb for six people. Adjust the roasting time to your actual joint.
  - type: checklist
    id: cooking
    title: Cooking checklist
    callback: {name: toggleChecklist}
    items:
      - id: prep_ahead
        meta: Saturday
        text: Prep ahead
        detail: Make the crumble, prepare the lamb marinade, check your serving dishes and set the table.
        checked: true
      - id: prepare_lamb
        meta: "12:30 PM"
        text: Prepare the lamb
        detail: Season with garlic, rosemary, lemon and olive oil. Refrigerate until closer to roasting.
      - id: start_roasting
        meta: "1:30 PM"
        text: Start roasting
        detail: Preheat the oven and roast the lamb. Use a meat thermometer rather than relying only on timing.
      - id: prepare_sides
        meta: "2:30 PM"
        text: Prepare the sides
        detail: Peel and chop vegetables. Parboil potatoes, drain and rough up their edges.
      - id: check_lamb
        meta: "3:30 PM"
        text: Check the lamb
        detail: Monitor its internal temperature. Once cooked, rest it loosely covered. Roast the potatoes and vegetables while it rests.
      - id: finish_everything
        meta: "4:15 PM"
        text: Finish everything
        detail: Make the gravy, cook the greens and warm the serving dishes.
      - id: carve_serve
        meta: "4:45 PM"
        text: Carve and serve
        detail: Check the potatoes and vegetables, carve the lamb and bring everything to the table.
      - id: dinner
        meta: "5:00 PM"
        text: Dinner!
        detail: Enjoy. Reheat the apple crumble while everyone finishes their main course.
  - type: context
    id: usda_note
    text: For food safety, the USDA recommends cooking whole cuts of lamb to an internal temperature of 145°F, followed by at least a three-minute rest. Your actual cooking time will vary by joint size and oven.
  - type: heading
    size: md
    text: 4. Three hosting tips
  - type: text
    id: hosting_tips
    markdown: |-
      - **Buy the lamb last:** Confirm your numbers before purchasing. Your butcher can help you choose the right size.
      - **Make dessert ahead:** One less thing to think about on Sunday.
      - **Protect your oven space:** The lamb and potatoes both need room. If you're cooking for eight or more, consider two smaller roasting trays and prepare the vegetables ahead.
  - type: text
    markdown: My one addition would be a simple starter of olives, good bread and whipped feta. Guests can nibble while you finish cooking, without spoiling their appetites.
  - type: actions
    id: follow_ups
    elements:
      - type: button
        id: adjust_for_five
        text: Adjust the plan for 5 guests
        variant: outline
        action: {kind: reply, text: Help me adjust the lamb roast plan for 5 guests}
      - type: button
        id: vegetarian_sides
        text: Add vegetarian sides
        variant: outline
        action: {kind: reply, text: Add vegetarian side dish options for the lamb roast menu}
      - type: button
        id: gluten_free
        text: Make it gluten-free
        variant: outline
        action: {kind: reply, text: Advise on making the lamb roast plan gluten-free}
`;

const SIGNUPS_DATASETS = `datasets:
  signups:
    columns:
      - {name: month, type: string}
      - {name: count, type: number}
    rows:
      - [Jan, 120]
      - [Feb, 180]
      - [Mar, 90]
      - [Apr, 210]
  signups_weekly:
    columns:
      - {name: week, type: string}
      - {name: count, type: number}
    rows:
      - [W1, 40]
      - [W2, 55]
      - [W3, 35]
      - [W4, 70]
`;

const HEADING = `v: 1
blocks:
  - type: heading
    size: 2xl
    text: Heading 2xl
  - type: heading
    size: xl
    text: Heading xl
  - type: heading
    size: lg
    text: Heading lg
  - type: heading
    size: md
    text: Heading md
  - type: heading
    size: sm
    text: Heading sm
`;

const TEXT = `v: 1
blocks:
  - type: text
    markdown: |-
      Text is **markdown**: *emphasis*, \`code\`, and [links](https://terreno.dev).

      - A bulleted list
      - with two items
`;

const METRIC = `v: 1
blocks:
  - type: metric
    label: Revenue
    value: "$48,200"
    delta: "+8%"
    trend: up
    helper: Compared with last month
  - type: metric
    label: Churn
    value: "2.1%"
    delta: "-0.4 pts"
    trend: down
  - type: metric
    label: Seats
    value: "120"
    delta: "0"
    trend: flat
`;

const BADGE = `v: 1
blocks:
  - {type: badge, status: info, text: Info}
  - {type: badge, status: success, text: Success}
  - {type: badge, status: warning, text: Warning}
  - {type: badge, status: error, text: Error}
  - {type: badge, status: neutral, text: Neutral}
  - {type: badge, status: active, text: Active}
`;

const DIVIDER = `v: 1
blocks:
  - type: text
    markdown: Above the divider.
  - type: divider
  - type: text
    markdown: Below the divider.
`;

const CONTEXT = `v: 1
blocks:
  - type: text
    markdown: Signups grew 12% this quarter.
  - type: context
    text: Source - the signups dataset, refreshed hourly. Context is small, muted, and plain text.
`;

const COLUMNS = `v: 1
blocks:
  - type: columns
    children:
      - type: metric
        label: Total
        value: "403"
        delta: "+12%"
        trend: up
      - type: metric
        label: Best month
        value: Feb
      - type: text
        markdown: Columns hold **2 to 4** children side by side and stack on narrow screens.
`;

const CARD = `v: 1
blocks:
  - type: card
    id: plan
    eyebrow: Your dinner plan
    title: Sunday roast with friends
    children:
      - type: text
        markdown: A card groups blocks under an optional small eyebrow and a title.
      - type: badge
        status: info
        text: Draft
  - type: card
    title: A card without an eyebrow
    children:
      - type: context
        text: Cards hold any blocks, including columns.
`;

const CHART = `v: 1
${SIGNUPS_DATASETS}blocks:
  - type: chart
    kind: line
    title: Line
    data: signups
    x: month
    y: count
  - type: chart
    kind: bar
    title: Bar
    data: signups
    x: month
    y: count
  - type: chart
    kind: area
    title: Area
    data: signups
    x: month
    y: count
  - type: chart
    kind: donut
    title: Donut
    legend: true
    points:
      - {label: Web, value: 70}
      - {label: iOS, value: 20}
      - {label: Android, value: 10}
`;

const TABLE = `v: 1
datasets:
  team:
    columns:
      - {name: name, type: string}
      - {name: role, type: string}
      - {name: seats_used, type: number}
      - {name: joined, type: date}
    rows:
      - [Ada, Admin, 12, "2026-01-04"]
      - [Grace, Editor, 7, "2026-03-18"]
      - [Linus, Viewer, 2, "2026-06-30"]
blocks:
  - type: table
    id: team_table
    title: Team
    data: team
`;

const ACTIONS = `v: 1
${SIGNUPS_DATASETS}blocks:
  - type: chart
    id: signups_chart
    kind: bar
    title: Signups
    data: signups
    x: month
    y: count
  - type: actions
    id: chart_actions
    elements:
      - type: segmented
        id: grain
        target: signups_chart
        options:
          - {label: Month, data: signups}
          - {label: Week, data: signups_weekly}
      - type: button
        id: show_weekly
        text: Select weekly
        variant: secondary
        action: {kind: select, target: signups_chart, data: signups_weekly}
  - type: actions
    id: more_actions
    elements:
      - type: button
        id: reply_btn
        text: Reply
        action: {kind: reply, text: Break signups down by channel}
      - type: button
        id: open_btn
        text: Open report
        variant: outline
        action: {kind: open, url: "https://example.com/reports/signups"}
      - type: button
        id: open_route_btn
        text: Open settings
        variant: ghost
        action: {kind: open, route: /settings}
      - type: button
        id: export_btn
        text: Export CSV
        variant: outline
        iconName: download
        action: {kind: callback, name: exportDataset, payload: {dataset: signups}}
      - type: button
        id: copy_btn
        text: Copy summary
        variant: outline
        iconName: copy
        action: {kind: copy, text: "Signups: Jan 120, Feb 180, Mar 90, Apr 210."}
`;

const HTML = `v: 1
blocks:
  - type: html
    title: Sandboxed HTML
    height: sm
    html: "<h3 style='font-family: sans-serif'>Hello from an html block</h3><p style='font-family: sans-serif'>It renders in a sandboxed frame only when allowHtml is on.</p>"
`;

const CALLOUT = `v: 1
blocks:
  - {type: callout, status: info, text: "Info: seats renew on Friday."}
  - {type: callout, status: warning, text: "Warning: two seats are unused."}
  - {type: callout, status: alert, text: "Alert: the card on file expired."}
`;

const IMAGE = `v: 1
blocks:
  - type: image
    alt: A table set for a Sunday dinner
    src: "file:dinner-table"
`;

const DETAILS = `v: 1
blocks:
  - type: details
    title: Invoice notes
    text: Twelve seats, billed monthly. Tap the title to fold the details away.
`;

const STEPPER = `v: 1
blocks:
  - type: stepper
    id: servings
    label: Servings
    unit: People
    value: 4
    min: 2
    max: 12
    step: 2
    callback: {name: scaleStepper}
    itemsTitle: Crumble ingredients
    items:
      - {label: Apples, amount: 4, round: up}
      - {label: Butter, amount: 100, unit: g}
      - {label: Oats, amount: 0.5, unit: cups, decimals: 2}
    note: Press − or + to scale every amount from the original.
`;

const CHECKLIST = `v: 1
blocks:
  - type: checklist
    id: packing
    title: Packing list
    callback: {name: toggleChecklist}
    items:
      - {id: passport, meta: Today, text: Passport, detail: Check it expires after the trip., checked: true}
      - {id: charger, meta: Tonight, text: Phone charger}
      - {id: snacks, text: Snacks for the train, detail: Something that will not melt.}
`;

const GALLERY = `v: 1
blocks:
  - type: gallery
    id: roast_photos
    images:
      - {src: "file:roast-lamb", alt: Roast leg of lamb, caption: Roast lamb}
      - {src: "file:roast-potatoes", alt: Crisp roast potatoes, caption: Roast potatoes}
      - {src: "file:roast-plate", alt: A plated Sunday roast, caption: Sunday roast}
`;

const LIST = `v: 1
blocks:
  - type: list
    id: menu
    items:
      - title: Rosemary and garlic roast lamb
        meta: Main
        text: A leg of lamb with lemon, garlic, rosemary, and olive oil.
        image: {src: "file:roast-lamb", alt: Roast lamb}
      - title: Extra-crispy roast potatoes
        meta: Side
        text: Parboiled, roughed up, and roasted until golden.
        image: {src: "file:roast-potatoes", alt: Roast potatoes}
      - title: Honey-roasted carrots and parsnips
        meta: Side
        text: Tossed with olive oil, honey, and thyme.
        image: {src: "file:roasted-carrots", alt: Carrots and parsnips}
      - title: Lemony greens
        meta: Side
        text: Tenderstem broccoli with almonds and lemon zest.
        image: {src: "file:greens", alt: Lemony greens}
      - title: Warm apple crumble
        meta: Pudding
        text: Make it the day before and reheat.
        image: {src: "file:apple-crumble", alt: Apple crumble}
`;

const ALL_BLOCKS = `v: 1
${SIGNUPS_DATASETS}blocks:
  - type: heading
    size: lg
    text: Every block type
  - type: text
    markdown: One of each block, in schema order. **Markdown** works here.
  - type: metric
    label: Total signups
    value: "600"
    delta: "+12%"
    trend: up
  - type: badge
    status: success
    text: Live
  - type: divider
  - type: context
    text: Context is small, muted, plain text.
  - type: chart
    id: signups_chart
    kind: line
    title: Signups
    data: signups
    x: month
    y: count
  - type: table
    id: signups_table
    title: Signups by month
    data: signups
  - type: actions
    id: all_actions
    elements:
      - type: segmented
        id: grain
        target: signups_chart
        options:
          - {label: Month, data: signups}
          - {label: Week, data: signups_weekly}
      - type: button
        id: reply_btn
        text: Reply
        action: {kind: reply, text: Break signups down by channel}
      - type: button
        id: open_btn
        text: Open report
        variant: outline
        action: {kind: open, url: "https://example.com/reports/signups"}
      - type: button
        id: export_btn
        text: Export CSV
        variant: outline
        action: {kind: callback, name: exportDataset, payload: {dataset: signups}}
      - type: button
        id: copy_btn
        text: Copy table
        variant: ghost
        action: {kind: copy, target: signups_table}
  - type: html
    title: Sandboxed HTML
    height: sm
    html: "<p style='font-family: sans-serif'>An html block in a sandboxed frame.</p>"
  - type: callout
    status: info
    text: A callout draws attention to one line.
  - type: image
    alt: A table set for a Sunday dinner
    src: "file:dinner-table"
  - type: details
    title: Details
    text: Tap the title to fold the details away.
  - type: stepper
    id: guests
    label: Number of people
    unit: People
    value: 5
    min: 1
    max: 20
    callback: {name: scaleStepper}
    items:
      - {label: Bone-in leg of lamb, amount: 2, unit: kg, decimals: 1}
      - {label: Carrots, amount: 8, round: up}
  - type: checklist
    id: cooking
    title: Cooking checklist
    callback: {name: toggleChecklist}
    items:
      - {id: prep, meta: Saturday, text: Prep ahead, detail: Make the crumble., checked: true}
      - {id: roast, meta: "1:30 PM", text: Start roasting, detail: Use a meat thermometer.}
  - type: gallery
    id: photos
    images:
      - {src: "file:roast-lamb", alt: Roast lamb}
      - {src: "file:roast-potatoes", alt: Roast potatoes}
      - {src: "file:roast-plate", alt: A plated Sunday roast}
  - type: list
    id: menu
    items:
      - title: Roast lamb
        meta: Main
        text: Rosemary and garlic.
        image: {src: "file:roast-lamb", alt: Roast lamb}
      - title: Apple crumble
        meta: Pudding
        image: {src: "file:apple-crumble", alt: Apple crumble}
  - type: columns
    children:
      - {type: metric, label: Best month, value: Apr}
      - {type: metric, label: Worst month, value: Mar}
  - type: card
    eyebrow: Card eyebrow
    title: Card title
    children:
      - type: text
        markdown: A card groups blocks.
`;

/** Presets shown as buttons above the editor. */
export const MAIN_PRESETS = {
  "All blocks": ALL_BLOCKS,
  Invalid: INVALID,
  Layout: LAYOUT,
  "Sunday roast": ROAST,
} as const;

/** One preset per block type, keyed by the block `type`. */
export const BLOCK_TYPE_PRESETS = {
  actions: ACTIONS,
  badge: BADGE,
  callout: CALLOUT,
  card: CARD,
  chart: CHART,
  checklist: CHECKLIST,
  columns: COLUMNS,
  context: CONTEXT,
  details: DETAILS,
  divider: DIVIDER,
  gallery: GALLERY,
  heading: HEADING,
  html: HTML,
  image: IMAGE,
  list: LIST,
  metric: METRIC,
  stepper: STEPPER,
  table: TABLE,
  text: TEXT,
} as const;

export const PRESETS: Record<PresetName, string> = {...MAIN_PRESETS, ...BLOCK_TYPE_PRESETS};

export type PresetName = keyof typeof MAIN_PRESETS | keyof typeof BLOCK_TYPE_PRESETS;
