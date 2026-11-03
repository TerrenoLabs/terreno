import {describe, expect, it, mock} from "bun:test";
import {fireEvent, within} from "@testing-library/react-native";
import {DateTime} from "luxon";

import {ConflictSheet, type ConflictSheetProps, type SyncConflictItem} from "./ConflictSheet";
import {renderWithTheme} from "./test-utils";

/**
 * Timestamps render in the runner's own locale and zone, and the exact
 * separators shift between ICU versions — so derive the expectation the same way
 * the sheet does instead of pinning a literal string.
 */
const expectedTime = (iso: string): string =>
  DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);

const buildConflict = (overrides?: Partial<SyncConflictItem>): SyncConflictItem => ({
  collection: "todos",
  entityId: "todo-1",
  localData: JSON.stringify({title: "My local title", updated: "2026-01-02T15:04:00.000Z"}),
  mutationId: "m-1",
  serverData: JSON.stringify({title: "Server title", updated: "2026-01-02T16:05:00.000Z"}),
  ...overrides,
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flushDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 550));

describe("ConflictSheet", () => {
  it("renders each conflict with local and server summaries", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-item-todo-1")).toBeTruthy();
    expect(getByText("My local title")).toBeTruthy();
    expect(getByText("Server title")).toBeTruthy();
    // Asserted per row so a swap of the local and server columns fails here.
    expect(getByTestId("conflict-local-time-todo-1").props.children).toBe(
      expectedTime("2026-01-02T15:04:00.000Z")
    );
    expect(getByTestId("conflict-server-time-todo-1").props.children).toBe(
      expectedTime("2026-01-02T16:05:00.000Z")
    );
  });

  it("always renders a time row when conflict payloads have no usable timestamp", () => {
    const {getAllByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({title: "Local without time"}),
            serverData: JSON.stringify({title: "Server without time"}),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getAllByText("Time unavailable")).toHaveLength(2);
  });

  it("badges the server side when it has the later timestamp", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-server-recency-todo-1")).toBeTruthy();
    expect(queryByTestId("conflict-local-recency-todo-1")).toBeNull();
  });

  it("badges the local side when it has the later timestamp", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({title: "Local", updated: "2026-01-02T18:00:00.000Z"}),
            serverData: JSON.stringify({title: "Server", updated: "2026-01-02T16:05:00.000Z"}),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-local-recency-todo-1")).toBeTruthy();
    expect(queryByTestId("conflict-server-recency-todo-1")).toBeNull();
  });

  it("badges both sides as the same time when the timestamps match", () => {
    const {getAllByText, getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({title: "Local", updated: "2026-01-02T16:05:00.000Z"}),
            serverData: JSON.stringify({title: "Server", updated: "2026-01-02T16:05:00.000Z"}),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-local-recency-todo-1")).toBeTruthy();
    expect(getByTestId("conflict-server-recency-todo-1")).toBeTruthy();
    expect(getAllByText("Same time")).toHaveLength(2);
  });

  it("badges neither side when a timestamp is missing or unparseable", () => {
    const {queryByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({title: "Local", updated: "not a date"}),
            serverData: JSON.stringify({title: "Server"}),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(queryByTestId("conflict-local-recency-todo-1")).toBeNull();
    expect(queryByTestId("conflict-server-recency-todo-1")).toBeNull();
  });

  it("renders a caller-supplied title and description", () => {
    const {getByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        description="Pick one for your todos."
        onDismiss={() => {}}
        onResolve={() => {}}
        title="Todos don't match"
        visible={true}
      />
    );
    expect(getByText("Todos don't match")).toBeTruthy();
    expect(getByText("Pick one for your todos.")).toBeTruthy();
  });

  it("hides the description when an empty string is passed", () => {
    const {queryByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        description=""
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(queryByTestId("conflict-sheet-description")).toBeNull();
  });

  it("shows an empty state when there are no conflicts", () => {
    const {getByText} = renderWithTheme(
      <ConflictSheet conflicts={[]} onDismiss={() => {}} onResolve={() => {}} visible={true} />
    );
    expect(getByText("Nothing left to choose — you're all set.")).toBeTruthy();
  });

  it("keeps overflowing conflict content inside a bounded scroll view", () => {
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict(),
          buildConflict({entityId: "todo-2", mutationId: "m-2"}),
          buildConflict({entityId: "todo-3", mutationId: "m-3"}),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );

    const scrollView = getByTestId("conflict-sheet-scroll");
    expect(scrollView.props.style.maxHeight).toBeGreaterThan(0);
    expect(getByTestId("conflict-item-todo-3")).toBeTruthy();
  });

  it("explains the situation in plain language and labels each side clearly", () => {
    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-sheet-description")).toBeTruthy();
    expect(getByText("Your change")).toBeTruthy();
    expect(getByText("Other version")).toBeTruthy();
    expect(queryByText("What you edited on this device")).toBeNull();
    expect(
      queryByText("What's saved elsewhere — another device, another person, or an older copy")
    ).toBeNull();
    expect(getByText("Keep my change")).toBeTruthy();
    expect(getByText("Use the other version")).toBeTruthy();
    expect(getByText("Keep all of my changes")).toBeTruthy();
    expect(getByText("Use all other versions")).toBeTruthy();
  });

  it("renders only changed fields in both version columns", async () => {
    const {getAllByText, getByTestId, getByText, queryByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({
              completed: true,
              title: "My local title",
              unchanged: "same",
              updated: "2026-01-02T15:04:00.000Z",
            }),
            serverData: JSON.stringify({
              completed: false,
              title: "Server title",
              unchanged: "same",
              updated: "2026-01-02T16:05:00.000Z",
            }),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );

    fireEvent.press(getByTestId("conflict-diff-toggle-todo-1"));
    await flushDebounce();
    expect(getAllByText("Title")).toHaveLength(2);
    expect(getAllByText("Completed")).toHaveLength(2);
    expect(getByText("My local title")).toBeTruthy();
    expect(getByText("Server title")).toBeTruthy();
    expect(getByText("true")).toBeTruthy();
    expect(getByText("false")).toBeTruthy();
    expect(queryByText("Unchanged")).toBeNull();
    expect(queryByText("same")).toBeNull();
  });

  it("opens field diff rows when Diff is pressed", async () => {
    const {getAllByText, getByTestId, getByText, queryByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[
          buildConflict({
            localData: JSON.stringify({completed: true, title: "My local title"}),
            serverData: JSON.stringify({completed: false, title: "Server title"}),
          }),
        ]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );

    expect(getByText("Diff")).toBeTruthy();
    expect(queryByTestId("conflict-local-field-completed-todo-1")).toBeNull();
    fireEvent.press(getByTestId("conflict-diff-toggle-todo-1"));
    await flushDebounce();
    expect(getByText("Hide diff")).toBeTruthy();
    expect(getByTestId("conflict-local-field-completed-todo-1")).toBeTruthy();
    expect(getAllByText("Completed")).toHaveLength(2);
  });

  it("keeps each resolution button inside the version column it applies to", () => {
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );

    const localColumn = getByTestId("conflict-local-column-todo-1");
    const serverColumn = getByTestId("conflict-server-column-todo-1");
    expect(within(localColumn).getByTestId("conflict-keep-mine-button-m-1")).toBeTruthy();
    expect(within(serverColumn).getByTestId("conflict-use-server-button-m-1")).toBeTruthy();
  });

  it("calls onResolve with keepMine but keeps the sheet open until the conflict clears", async () => {
    const onResolve = mock((_args: Parameters<ConflictSheetProps["onResolve"]>[0]) => {});
    const onDismiss = mock(() => {});
    const {getByTestId, rerender} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={onDismiss}
        onResolve={onResolve}
        visible={true}
      />
    );
    fireEvent.press(getByTestId("conflict-keep-mine-button-m-1"));
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toEqual({mutationId: "m-1", strategy: "keepMine"});
    // Resolution has not landed yet (async in the data layer) — a failed resolve must
    // leave the conflict on screen rather than closing over it.
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(
      <ConflictSheet conflicts={[]} onDismiss={onDismiss} onResolve={onResolve} visible={true} />
    );
    await flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open when a resolution never lands", async () => {
    const onDismiss = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict()]}
        onDismiss={onDismiss}
        onResolve={() => {}}
        visible={true}
      />
    );
    fireEvent.press(getByTestId("conflict-use-server-button-m-1"));
    await flush();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(getByTestId("conflict-item-todo-1")).toBeTruthy();
  });

  it("does not dismiss a sheet opened with no conflicts at all", async () => {
    const onDismiss = mock(() => {});
    renderWithTheme(
      <ConflictSheet conflicts={[]} onDismiss={onDismiss} onResolve={() => {}} visible={true} />
    );
    await flush();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onResolve with useServer without dismissing when other conflicts remain", async () => {
    const onResolve = mock((_args: Parameters<ConflictSheetProps["onResolve"]>[0]) => {});
    const onDismiss = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict(), buildConflict({entityId: "todo-2", mutationId: "m-2"})]}
        onDismiss={onDismiss}
        onResolve={onResolve}
        visible={true}
      />
    );
    fireEvent.press(getByTestId("conflict-use-server-button-m-1"));
    await flush();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toEqual({mutationId: "m-1", strategy: "useServer"});
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("uses the server version for every conflict after confirmation, dismissing once they clear", async () => {
    const onResolve = mock((_args: Parameters<ConflictSheetProps["onResolve"]>[0]) => {});
    const onDismiss = mock(() => {});
    const {findByText, getByTestId, rerender} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict(), buildConflict({entityId: "todo-2", mutationId: "m-2"})]}
        onDismiss={onDismiss}
        onResolve={onResolve}
        visible={true}
      />
    );

    fireEvent.press(getByTestId("conflict-use-server-all-button"));
    fireEvent.press(await findByText("Confirm"));
    await flush();

    expect(onResolve).toHaveBeenCalledTimes(2);
    expect(onResolve.mock.calls.map(([args]) => args)).toEqual([
      {mutationId: "m-1", strategy: "useServer"},
      {mutationId: "m-2", strategy: "useServer"},
    ]);
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(
      <ConflictSheet conflicts={[]} onDismiss={onDismiss} onResolve={onResolve} visible={true} />
    );
    await flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the local version for every conflict after confirmation, dismissing once they clear", async () => {
    const onResolve = mock((_args: Parameters<ConflictSheetProps["onResolve"]>[0]) => {});
    const onDismiss = mock(() => {});
    const {findByText, getByTestId, rerender} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict(), buildConflict({entityId: "todo-2", mutationId: "m-2"})]}
        onDismiss={onDismiss}
        onResolve={onResolve}
        visible={true}
      />
    );

    fireEvent.press(getByTestId("conflict-use-mine-all-button"));
    fireEvent.press(await findByText("Confirm"));
    await flush();

    expect(onResolve).toHaveBeenCalledTimes(2);
    expect(onResolve.mock.calls.map(([args]) => args)).toEqual([
      {mutationId: "m-1", strategy: "keepMine"},
      {mutationId: "m-2", strategy: "keepMine"},
    ]);
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(
      <ConflictSheet conflicts={[]} onDismiss={onDismiss} onResolve={onResolve} visible={true} />
    );
    await flush();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("suffixes testIDs with mutationId so multiple conflicts never collide (E6, RN Testing Library strict-mode fix)", () => {
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict(), buildConflict({entityId: "todo-2", mutationId: "m-2"})]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    // getByTestId throws if more than one match is found — this is exactly
    // what would happen with the old shared "conflict-keep-mine-button" /
    // "conflict-use-server-button" testIDs across two rendered conflicts.
    expect(getByTestId("conflict-keep-mine-button-m-1")).toBeTruthy();
    expect(getByTestId("conflict-keep-mine-button-m-2")).toBeTruthy();
    expect(getByTestId("conflict-use-server-button-m-1")).toBeTruthy();
    expect(getByTestId("conflict-use-server-button-m-2")).toBeTruthy();
  });

  it("renders changed fields when a payload has no title", async () => {
    const {getAllByText, getByTestId, getByText} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict({localData: JSON.stringify({completed: true})})]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    fireEvent.press(getByTestId("conflict-diff-toggle-todo-1"));
    await flushDebounce();
    expect(getAllByText("Completed")).toHaveLength(2);
    expect(getByText("true")).toBeTruthy();
  });

  it("tolerates invalid JSON payloads", () => {
    const {getByTestId} = renderWithTheme(
      <ConflictSheet
        conflicts={[buildConflict({localData: "not json", serverData: "{bad"})]}
        onDismiss={() => {}}
        onResolve={() => {}}
        visible={true}
      />
    );
    expect(getByTestId("conflict-item-todo-1")).toBeTruthy();
  });
});
