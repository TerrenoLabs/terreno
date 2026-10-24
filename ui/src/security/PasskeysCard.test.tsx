import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import {ActivityIndicator} from "react-native";

import {renderWithTheme} from "../test-utils";
import {PasskeysCard} from "./PasskeysCard";
import type {AccountPasskey} from "./securityTypes";

const CREATED_AT = "2026-03-03T12:00:00.000Z";
const LAST_USED_AT = "2026-03-10T12:00:00.000Z";
// Computed with Luxon so the expectation follows the test runner's locale and time zone.
const CREATED_DATE = DateTime.fromISO(CREATED_AT).toLocaleString(DateTime.DATE_MED);
const LAST_USED_DATE = DateTime.fromISO(LAST_USED_AT).toLocaleString(DateTime.DATE_MED);

const LAPTOP: AccountPasskey = {
  backedUp: true,
  createdAt: CREATED_AT,
  id: "pk-laptop",
  lastUsedAt: LAST_USED_AT,
  name: "Work laptop",
};
const KEY: AccountPasskey = {
  backedUp: false,
  createdAt: new Date(CREATED_AT),
  id: "pk-key",
  name: "YubiKey",
};

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

const isDisabled = (element: {props: Record<string, unknown>}): boolean => {
  const state = element.props.accessibilityState as {disabled?: boolean} | undefined;
  return Boolean(state?.disabled);
};

describe("PasskeysCard", () => {
  it("lists each passkey with its name, created and last-used dates", () => {
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        onRemove={mock(() => Promise.resolve())}
        onRename={mock(() => Promise.resolve())}
        passkeys={[LAPTOP, KEY]}
      />
    );
    expect(getByTestId("passkeys-card-name-pk-laptop").props.children).toBe("Work laptop");
    expect(getByTestId("passkeys-card-status-pk-laptop").props.children).toBe(
      `Added ${CREATED_DATE} · Last used ${LAST_USED_DATE}`
    );
    expect(getByTestId("passkeys-card-name-pk-key").props.children).toBe("YubiKey");
    expect(getByTestId("passkeys-card-status-pk-key").props.children).toBe(`Added ${CREATED_DATE}`);
  });

  it("marks backed-up passkeys as synced", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<PasskeysCard passkeys={[LAPTOP, KEY]} />);
    expect(getByTestId("passkeys-card-synced-pk-laptop")).toBeTruthy();
    expect(queryByTestId("passkeys-card-synced-pk-key")).toBeNull();
  });

  it("names an unnamed passkey and names buttons after each passkey", () => {
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        onRemove={mock(() => Promise.resolve())}
        onRename={mock(() => Promise.resolve())}
        passkeys={[{id: "pk-1"}, LAPTOP]}
      />
    );
    expect(getByTestId("passkeys-card-name-pk-1").props.children).toBe("Unnamed passkey");
    expect(getByTestId("passkeys-card-status-pk-1").props.children).toBe("Passkey");
    expect(getByTestId("passkeys-card-remove-pk-laptop").props.accessibilityLabel).toBe(
      "Remove passkey Work laptop"
    );
    expect(getByTestId("passkeys-card-rename-pk-laptop").props.accessibilityLabel).toBe(
      "Rename passkey Work laptop"
    );
  });

  it("labels an unnamed passkey with its authenticator name, after its own name", () => {
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        onRemove={mock(() => Promise.resolve())}
        passkeys={[
          {authenticatorName: "iCloud Keychain", id: "pk-icloud"},
          {authenticatorName: "iCloud Keychain", id: "pk-named", name: "Phone"},
        ]}
      />
    );
    expect(getByTestId("passkeys-card-name-pk-icloud").props.children).toBe("iCloud Keychain");
    expect(getByTestId("passkeys-card-remove-pk-icloud").props.accessibilityLabel).toBe(
      "Remove passkey iCloud Keychain"
    );
    expect(getByTestId("passkeys-card-name-pk-named").props.children).toBe("Phone");
  });

  it("shows an empty state with Add when there are no passkeys", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard onAdd={mock(() => Promise.resolve())} passkeys={[]} />
    );
    expect(getByTestId("passkeys-card-empty")).toBeTruthy();
    expect(getByTestId("passkeys-card-add")).toBeTruthy();
    expect(queryByTestId("passkeys-card-unsupported")).toBeNull();
  });

  it("explains and hides Add when the device can't create passkeys", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard
        onAdd={mock(() => Promise.resolve())}
        onRemove={mock(() => Promise.resolve())}
        passkeys={[LAPTOP]}
        supported={false}
      />
    );
    expect(getByTestId("passkeys-card-unsupported")).toBeTruthy();
    expect(queryByTestId("passkeys-card-add")).toBeNull();
    expect(getByTestId("passkeys-card-remove-pk-laptop")).toBeTruthy();
  });

  it("asks for an optional name and calls onAdd with it", async () => {
    const onAdd = mock((_name?: string) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard onAdd={onAdd} passkeys={[]} />
    );
    await press(getByTestId("passkeys-card-add"));
    expect(onAdd).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.changeText(getByTestId("passkeys-card-add-dialog-name"), "  Phone  ");
    });
    await press(getByTestId("passkeys-card-add-dialog-submit"));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("Phone");
    });
    expect(queryByTestId("passkeys-card-add-dialog")).toBeNull();
  });

  it("calls onAdd with undefined when the name is left blank", async () => {
    const onAdd = mock((_name?: string) => Promise.resolve());
    const {getByTestId} = renderWithTheme(<PasskeysCard onAdd={onAdd} passkeys={[]} />);
    await press(getByTestId("passkeys-card-add"));
    await press(getByTestId("passkeys-card-add-dialog-submit"));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(undefined);
    });
  });

  it("does not call onAdd when the add dialog is cancelled", async () => {
    const onAdd = mock((_name?: string) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard onAdd={onAdd} passkeys={[]} />
    );
    await press(getByTestId("passkeys-card-add"));
    await press(getByTestId("passkeys-card-add-dialog-cancel"));
    expect(queryByTestId("passkeys-card-add-dialog")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows a spinner on Add and disables the rows while adding", async () => {
    let resolveAdd: () => void = () => {};
    const onAdd = mock(
      (_name?: string) =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <PasskeysCard onAdd={onAdd} onRemove={mock(() => Promise.resolve())} passkeys={[LAPTOP]} />
    );
    await press(getByTestId("passkeys-card-add"));
    await press(getByTestId("passkeys-card-add-dialog-submit"));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalled();
    });
    expect(getByTestId("passkeys-card-add").findAllByType(ActivityIndicator).length).toBe(1);
    expect(isDisabled(getByTestId("passkeys-card-remove-pk-laptop"))).toBe(true);

    await act(async () => {
      resolveAdd();
    });
    await waitFor(() => {
      expect(isDisabled(getByTestId("passkeys-card-remove-pk-laptop"))).toBe(false);
    });
  });

  it("confirms before removing and calls onRemove with the passkey", async () => {
    const onRemove = mock((_passkey: AccountPasskey) => Promise.resolve());
    const {getByTestId, getByText, queryByTestId} = renderWithTheme(
      <PasskeysCard onRemove={onRemove} passkeys={[LAPTOP, KEY]} />
    );
    await press(getByTestId("passkeys-card-remove-pk-key"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(getByTestId("passkeys-card-confirm")).toBeTruthy();
    expect(getByText("Remove YubiKey?")).toBeTruthy();

    await press(getByTestId("passkeys-card-confirm-submit"));
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith(KEY);
    });
    expect(queryByTestId("passkeys-card-confirm")).toBeNull();
  });

  it("does not remove when the confirm is cancelled", async () => {
    const onRemove = mock((_passkey: AccountPasskey) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard onRemove={onRemove} passkeys={[LAPTOP]} />
    );
    await press(getByTestId("passkeys-card-remove-pk-laptop"));
    await press(getByTestId("passkeys-card-confirm-cancel"));
    expect(queryByTestId("passkeys-card-confirm")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("shows a spinner on the removing row and disables the others until it settles", async () => {
    let resolveRemove: () => void = () => {};
    const onRemove = mock(
      (_passkey: AccountPasskey) =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        onAdd={mock(() => Promise.resolve())}
        onRemove={onRemove}
        passkeys={[LAPTOP, KEY]}
      />
    );
    await press(getByTestId("passkeys-card-remove-pk-laptop"));
    await press(getByTestId("passkeys-card-confirm-submit"));
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalled();
    });
    const removing = getByTestId("passkeys-card-remove-pk-laptop");
    expect(removing.findAllByType(ActivityIndicator).length).toBe(1);
    const other = getByTestId("passkeys-card-remove-pk-key");
    expect(isDisabled(other)).toBe(true);
    expect(other.findAllByType(ActivityIndicator).length).toBe(0);
    expect(isDisabled(getByTestId("passkeys-card-add"))).toBe(true);

    await act(async () => {
      resolveRemove();
    });
    await waitFor(() => {
      expect(isDisabled(getByTestId("passkeys-card-remove-pk-key"))).toBe(false);
    });
  });

  it("renames a passkey with the trimmed new name", async () => {
    const onRename = mock((_id: string, _name: string) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <PasskeysCard onRename={onRename} passkeys={[LAPTOP]} />
    );
    await press(getByTestId("passkeys-card-rename-pk-laptop"));
    expect(getByTestId("passkeys-card-rename-dialog-name").props.value).toBe("Work laptop");
    await act(async () => {
      fireEvent.changeText(getByTestId("passkeys-card-rename-dialog-name"), " Home laptop ");
    });
    await press(getByTestId("passkeys-card-rename-dialog-submit"));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("pk-laptop", "Home laptop");
    });
    expect(queryByTestId("passkeys-card-rename-dialog")).toBeNull();
  });

  it("shows a spinner on Rename, not Remove, while renaming", async () => {
    let resolveRename: () => void = () => {};
    const onRename = mock(
      (_id: string, _name: string) =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        onRemove={mock(() => Promise.resolve())}
        onRename={onRename}
        passkeys={[LAPTOP]}
      />
    );
    await press(getByTestId("passkeys-card-rename-pk-laptop"));
    await act(async () => {
      fireEvent.changeText(getByTestId("passkeys-card-rename-dialog-name"), "Home laptop");
    });
    await press(getByTestId("passkeys-card-rename-dialog-submit"));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalled();
    });
    expect(
      getByTestId("passkeys-card-rename-pk-laptop").findAllByType(ActivityIndicator).length
    ).toBe(1);
    const remove = getByTestId("passkeys-card-remove-pk-laptop");
    expect(remove.findAllByType(ActivityIndicator).length).toBe(0);
    expect(isDisabled(remove)).toBe(true);
    await act(async () => {
      resolveRename();
    });
  });

  it("disables Save in the rename dialog while the name is blank or unchanged", async () => {
    const onRename = mock((_id: string, _name: string) => Promise.resolve());
    const {getByTestId} = renderWithTheme(<PasskeysCard onRename={onRename} passkeys={[LAPTOP]} />);
    await press(getByTestId("passkeys-card-rename-pk-laptop"));
    expect(isDisabled(getByTestId("passkeys-card-rename-dialog-submit"))).toBe(true);
    await act(async () => {
      fireEvent.changeText(getByTestId("passkeys-card-rename-dialog-name"), "   ");
    });
    expect(isDisabled(getByTestId("passkeys-card-rename-dialog-submit"))).toBe(true);
    await press(getByTestId("passkeys-card-rename-dialog-submit"));
    expect(onRename).not.toHaveBeenCalled();
    await press(getByTestId("passkeys-card-rename-dialog-cancel"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("shows a rejected callback's message as an alert", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const onRemove = mock((_passkey: AccountPasskey) =>
      Promise.reject(new Error("That passkey is already gone."))
    );
    const {getByTestId, getByText} = renderWithTheme(
      <PasskeysCard onRemove={onRemove} passkeys={[LAPTOP]} />
    );
    await press(getByTestId("passkeys-card-remove-pk-laptop"));
    await press(getByTestId("passkeys-card-confirm-submit"));
    await waitFor(() => {
      expect(getByTestId("passkeys-card-error")).toBeTruthy();
    });
    expect(getByTestId("passkeys-card-error").props.role).toBe("alert");
    expect(getByText("That passkey is already gone.")).toBeTruthy();
    expect(isDisabled(getByTestId("passkeys-card-remove-pk-laptop"))).toBe(false);
    warn.mockRestore();
  });

  it("falls back to a generic message when onAdd rejects without one", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <PasskeysCard onAdd={mock((_name?: string) => Promise.reject("cancelled"))} passkeys={[]} />
    );
    await press(getByTestId("passkeys-card-add"));
    await press(getByTestId("passkeys-card-add-dialog-submit"));
    await waitFor(() => {
      expect(getByTestId("passkeys-card-error")).toBeTruthy();
    });
    expect(getByText("Couldn't add a passkey. Try again.")).toBeTruthy();
    warn.mockRestore();
  });

  it("shows the error prop as an alert", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <PasskeysCard error="Passkeys couldn't load." passkeys={[]} />
    );
    expect(getByTestId("passkeys-card-error").props.role).toBe("alert");
    expect(getByText("Passkeys couldn't load.")).toBeTruthy();
  });

  it("disables every button with the disabled prop", () => {
    const {getByTestId} = renderWithTheme(
      <PasskeysCard
        disabled
        onAdd={mock(() => Promise.resolve())}
        onRemove={mock(() => Promise.resolve())}
        onRename={mock(() => Promise.resolve())}
        passkeys={[LAPTOP]}
      />
    );
    expect(isDisabled(getByTestId("passkeys-card-add"))).toBe(true);
    expect(isDisabled(getByTestId("passkeys-card-remove-pk-laptop"))).toBe(true);
    expect(isDisabled(getByTestId("passkeys-card-rename-pk-laptop"))).toBe(true);
  });

  it("hides buttons whose callbacks are not given", () => {
    const {queryByTestId} = renderWithTheme(<PasskeysCard passkeys={[LAPTOP]} />);
    expect(queryByTestId("passkeys-card-add")).toBeNull();
    expect(queryByTestId("passkeys-card-remove-pk-laptop")).toBeNull();
    expect(queryByTestId("passkeys-card-rename-pk-laptop")).toBeNull();
  });
});
