# UI performance benchmarks

Run the benchmark that covers the component being changed:

```bash
cd ui
bun run performance:p0
bun run performance:p0:openapi
bun run performance:p1
bun run performance:p2:button
bun run performance:p2:responsive-box
bun run performance:datatable-virtual
bun run performance:imports
```

The benchmarks render large trees through the same React Native test environment as the UI
component suite. They report median wall-clock times after two warmups and seven measured samples:

- 500 `Box`, `Text`, and `Heading` instances
- 100 `MarkdownView` instances
- 500 theme consumers
- 500 `useOpenAPISpec` consumers
- a 100-row, eight-column `DataTable` with two pinned columns
- 500 `Icon` instances
- 500 plain `Button` instances and 100 confirmation `Button` instances
- 500 responsive `Box` instances with `sm`, `md`, and `lg` direction props
- 1,000-row `DataTable` workloads with pinned and unpinned virtualization
- initial mount, same-prop update, and changed-prop/theme update timings

Use it for before/after comparisons on the same machine. It is not a device frame-rate benchmark;
native and browser profiling remain necessary for user-visible regressions.

## August 2026 P0 optimization results

All measurements below came from the same Cursor Cloud VM using Bun 1.3.11 and the default benchmark
settings. Times are milliseconds; lower is better.

| Step | Box same | Text same | Heading same | Markdown same | Theme same |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 6.86 | 4.70 | 4.69 | 37.87 | 1.29 |
| Memoize `Box` and reuse its style/ref | 5.78 | 4.84 | 4.69 | 30.58 | 1.63 |
| Centralize fonts; memoize typography and markdown styles | 5.71 | 4.03 | 3.94 | 0.63 | 1.20 |
| Stabilize theme actions and context value | 1.07 | 0.96 | 0.86 | 0.33 | 1.22 |
| Share `Box` style mappers per computed theme | 1.01 | 0.90 | 0.79 | 0.31 | 1.21 |

Final same-prop improvements versus baseline:

| Workload | Improvement |
| --- | ---: |
| `Box` | 85.2% |
| `Text` | 80.9% |
| `Heading` | 83.2% |
| `MarkdownView` | 99.2% |
| Theme consumers | 6.4% |

Changed-prop work remains intact: the final medians were 9.02ms for `Box`, 6.89ms for `Text`,
6.52ms for `Heading`, and 28.08ms for `MarkdownView`. This is intentional: memoization skips only
equivalent props, while changed props and theme values still render and are covered by
`P0RenderRegression.test.tsx`.

## August 2026 P1 optimization results

These measurements used the same Cursor Cloud VM and Bun 1.3.11, with 21 measured samples to reduce
variance. The changed `DataTable` workload replaces one cell while preserving the other row
references. Times are milliseconds; lower is better.

| Workload | Phase | Baseline | Optimized | Change |
| --- | --- | ---: | ---: | ---: |
| `DataTable` | Initial render | 23.20 | 24.08 | Within benchmark variance |
| `DataTable` | Same-prop update | 32.49 | 0.18 | 99.4% faster |
| `DataTable` | One-cell update | 31.74 | 1.57 | 95.1% faster |
| `Icon` | Initial render | 1.47 | 1.50 | Within benchmark variance |
| `Icon` | Same-prop update | 1.81 | 0.93 | 48.6% faster |
| `Icon` | Changed-prop update | 3.07 | 3.61 | Full redraw retained |

`DataTable` now reuses equivalent table, content, row, and cell work; computes pinned offsets once;
and applies the default text size without cloning the full grid. `Icon` skips equivalent parent
updates while still redrawing for icon prop and theme changes. `P1RenderRegression.test.tsx` covers
both guarantees.

The P1 example renderers import public component subpaths such as `@terreno/ui/DataTable` and
`@terreno/ui/Icon`. These subpaths avoid evaluating the complete root export graph. The root
`@terreno/ui` import and existing direct `src`/`dist` paths remain supported.

## August 2026 OpenAPI context optimization results (Task 1.1)

These measurements used the same Cursor Cloud VM and Bun 1.3.11, with 21 measured samples and 3
warmups. The workload renders 500 `useOpenAPISpec` consumers under a parent rerender with an
unchanged spec, then replaces the spec URL so field lookups must refresh. Times are milliseconds;
lower is better.

| Phase | Baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| Initial render | 1.65 | 1.64 | Within benchmark variance |
| Same-prop update | 1.91 | 1.70 | 11.0% faster |
| Spec replacement update | 1.76 | 1.79 | Within benchmark variance |

`OpenAPIProvider` now memoizes `getModelField`, `getModelFields`, and the context value with complete
`spec` dependencies. Unchanged metadata skips memoized consumers; replacing the spec updates field
lookups immediately. `OpenAPIRenderRegression.test.tsx` covers both guarantees.

## August 2026 DataTable virtualization results

These measurements used the same Cursor Cloud VM and Bun 1.3.11, with 21 measured samples and 1,000-row
pinned and unpinned workloads (`bun run performance:datatable-virtual`). Mounted row counts count unique
`bench-table.row-*` test ids present after the initial render. Times are milliseconds; lower is better.

| Workload | Phase | Baseline | Virtualized | Change |
| --- | --- | ---: | ---: | ---: |
| `DataTable` unpinned | Initial render | 224.59 | 3.45 | 98.5% faster |
| `DataTable` unpinned | Same-prop update | 4.38 | 0.72 | 83.6% faster |
| `DataTable` unpinned | One-cell update | 4.19 | 1.25 | 70.2% faster |
| `DataTable` unpinned | Mounted rows | 1,000 | 15 | 98.5% fewer |
| `DataTable` pinned (2 cols) | Initial render | 232.72 | 3.09 | 98.7% faster |
| `DataTable` pinned (2 cols) | Same-prop update | 7.17 | 0.69 | 90.4% faster |
| `DataTable` pinned (2 cols) | One-cell update | 6.86 | 1.31 | 80.9% faster |
| `DataTable` pinned (2 cols) | Mounted rows | 1,000 | 15 | 98.5% fewer |

Large `DataTable` bodies now virtualize with React Native `FlatList`, syncing pinned, more-column, and
scrollable row lists while preserving horizontal header/body scroll sync, sorting, pagination, pinned
columns, row-detail modals, custom cells, highlights, and row test ids. `DataTableVirtualizationRegression.test.tsx`
covers viewport-bounded mounts, queued vertical-scroll flush after the sync lock, and changed rows after scrolling.

## August 2026 root import optimization results

These measurements used the same Cursor Cloud VM and Bun 1.3.11. Each workload uses a fresh Bun test process
(seven measured samples, two warmups). The graph columns count evaluated `@terreno/ui` source modules reached through
static `import`/`export` edges (type-only re-exports are excluded). Output bytes sum those module file sizes. Elapsed
time includes dependency evaluation in the Bun test harness. Lower is better.

| Workload | Modules | Output bytes | Elapsed (ms) | Baseline modules | Baseline bytes | Baseline elapsed (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `@terreno/ui/Button` subpath | 17 | 345,992 | 22.8 | 19 | 383,185 | 22.3 |
| `@terreno/ui` root | 138 | 889,124 | 189.3 | 151 | 1,031,537 | 207.9 |
| `@terreno/ui/DataTable` subpath | 25 | 387,392 | 24.9 | 26 | 424,006 | 44.6 |
| `@terreno/ui/MarkdownView` subpath | 5 | 19,036 | 3.5 | 7 | 148,456 | 27.0 |

Changes in this slice:

- Measured heavy optional widgets (`GPTChat`, `EmojiSelector`, `MarkdownEditor`, consent/admin tools, `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, and related
  exports) now cross lazy root boundaries so their implementation files stay off the cold root import path.
  `DashboardGrid` stays eager.
- `MarkdownView`, `DataTable` header info, and `EmojiSelector` defer `react-native-markdown-display` and
  `emoji-datasource` until first use.
- `RootImportRegression.test.tsx` and `bun run performance:imports` guard the public entrypoints.

Run the import benchmark locally:

```bash
cd ui
bun run performance:imports
```

Override sample counts when comparing smaller deltas:

```bash
UI_IMPORT_BENCHMARK_SAMPLES=21 \
UI_IMPORT_BENCHMARK_WARMUPS=3 \
bun run performance:imports
```

The benchmark prints a machine-readable `UI_IMPORT_BENCHMARK_RESULTS` JSON line for CI or local reporting.

## August 2026 P2 Button optimization results

These measurements used the same Cursor Cloud VM and Bun 1.3.11, with 21 measured samples. The
changed workload replaces one button label or confirmation message while preserving every other
prop. Times are milliseconds; lower is better.

| Workload | Phase | Baseline | Optimized | Change |
| --- | --- | ---: | ---: | ---: |
| Plain `Button` | Initial render | 7.85 | 8.66 | Within benchmark variance |
| Plain `Button` | Same-prop update | 13.73 | 0.94 | 93.1% faster |
| Plain `Button` | One-label update | 11.99 | 0.98 | 91.8% faster |
| Confirmation `Button` | Initial render | 1.71 | 1.93 | Within benchmark variance |
| Confirmation `Button` | Same-prop update | 2.79 | 0.30 | 89.2% faster |
| Confirmation `Button` | One-message update | 2.71 | 0.32 | 88.3% faster |

`Button` now skips equivalent parent updates, keeps debounce identity stable, and cancels retained
debounce timers on replacement or unmount. Plain buttons use a separate path that does not allocate
confirmation state or request the lazy modal. Delayed handlers remain disabled until completion.
Confirmation buttons clear the press cooldown when the modal closes, so Cancel, dismiss, or Confirm
still allows an immediate reopen while repeated presses that do not close the modal stay debounced.
`P2ButtonRenderRegression.test.tsx` covers equivalent props plus changed labels, confirmation
content, and theme values.

## August 2026 P2 responsive Box optimization results

These measurements used the same Cursor Cloud VM and Bun 1.3.11, with 21 measured samples. Times
are milliseconds; lower is better.

| Phase | Baseline | Optimized | Change |
| --- | ---: | ---: | ---: |
| Initial render | 3.01 | 3.12 | Within benchmark variance |
| Same-prop update | 0.89 | 0.88 | Within benchmark variance |
| One-direction update | 0.92 | 0.90 | Within benchmark variance |
| Initial `Dimensions.get` calls | 1,500 | 1 | 99.9% fewer |

Responsive Boxes now subscribe to one shared window-dimension source. A resize or rotation updates
the cached breakpoint and every subscribed Box without a synchronous dimension read per responsive
prop. Non-responsive Boxes do not subscribe. Focused regressions cover the native 320pt / 375pt / 600pt /
1024pt boundaries, the web 1024pt / 1280pt desktop boundaries, listener sharing, cleanup, and
changed responsive styles.

## Environment overrides

Increase samples or workload size when comparing smaller changes:

```bash
UI_P0_BENCHMARK_SAMPLES=21 \
UI_P0_BENCHMARK_WARMUPS=3 \
UI_P0_BENCHMARK_SIZE=1000 \
bun run performance:p0
```

```bash
UI_P1_BENCHMARK_SAMPLES=21 \
UI_P1_BENCHMARK_WARMUPS=3 \
UI_P1_BENCHMARK_TABLE_ROWS=200 \
UI_P1_BENCHMARK_ICONS=1000 \
bun run performance:p1
```

```bash
UI_P0_OPENAPI_BENCHMARK_SAMPLES=21 \
UI_P0_OPENAPI_BENCHMARK_WARMUPS=3 \
UI_P0_OPENAPI_BENCHMARK_SIZE=500 \
bun run performance:p0:openapi
```

```bash
UI_P2_BUTTON_BENCHMARK_SAMPLES=21 \
UI_P2_BUTTON_BENCHMARK_WARMUPS=3 \
UI_P2_BUTTON_BENCHMARK_SIZE=1000 \
UI_P2_CONFIRMATION_BUTTON_BENCHMARK_SIZE=200 \
bun run performance:p2:button
```

```bash
UI_P2_RESPONSIVE_BOX_BENCHMARK_SAMPLES=21 \
UI_P2_RESPONSIVE_BOX_BENCHMARK_WARMUPS=3 \
UI_P2_RESPONSIVE_BOX_BENCHMARK_SIZE=1000 \
bun run performance:p2:responsive-box
```

```bash
UI_DATATABLE_VIRTUAL_BENCHMARK_SAMPLES=21 \
UI_DATATABLE_VIRTUAL_BENCHMARK_WARMUPS=3 \
UI_DATATABLE_VIRTUAL_BENCHMARK_ROWS=1500 \
bun run performance:datatable-virtual
```

The benchmarks print machine-readable `UI_P0_BENCHMARK_RESULTS`, `UI_P1_BENCHMARK_RESULTS`,
`UI_P2_BUTTON_BENCHMARK_RESULTS`, `UI_P2_RESPONSIVE_BOX_BENCHMARK_RESULTS`,
`UI_DATATABLE_VIRTUAL_BENCHMARK_RESULTS`, or `UI_IMPORT_BENCHMARK_RESULTS` JSON lines for CI or
local reporting.
