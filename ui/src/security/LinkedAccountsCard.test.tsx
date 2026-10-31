import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import {ActivityIndicator} from "react-native";

import {renderWithTheme} from "../test-utils";
import {LinkedAccountsCard} from "./LinkedAccountsCard";
import type {LinkableProvider, LinkedAccount} from "./securityTypes";

const PROVIDERS: LinkableProvider[] = [{id: "google"}, {id: "github"}];

const LINKED_AT = "2026-03-03T12:00:00.000Z";
// Computed with Luxon so the expectation follows the test runner's locale and time zone.
const LINKED_DATE = DateTime.fromISO(LINKED_AT).toLocaleString(DateTime.DATE_MED);

const GOOGLE: LinkedAccount = {
  accountId: "g-1",
  email: "ada@example.com",
  id: "acc-google",
  linkedAt: LINKED_AT,
  providerId: "google",
};
const CREDENTIAL: LinkedAccount = {
  accountId: "u-1",
  id: "acc-credential",
  providerId: "credential",
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

describe("LinkedAccountsCard", () => {
  it("lists linked providers with email and linked date, and unlinked ones with Link", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onLink={mock(() => Promise.resolve())}
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(getByTestId("linked-accounts-card")).toBeTruthy();
    expect(getByTestId("linked-accounts-card-name-google").props.children).toBe("Google");
    const googleStatus = String(getByTestId("linked-accounts-card-status-google").props.children);
    expect(googleStatus).toContain("ada@example.com");
    expect(googleStatus).toContain(`Linked ${LINKED_DATE}`);
    expect(getByTestId("linked-accounts-card-unlink-google")).toBeTruthy();
    expect(queryByTestId("linked-accounts-card-link-google")).toBeNull();

    expect(getByTestId("linked-accounts-card-status-github").props.children).toBe("Not linked");
    expect(getByTestId("linked-accounts-card-link-github")).toBeTruthy();
    expect(queryByTestId("linked-accounts-card-unlink-github")).toBeNull();
  });

  it("does not list the password credential as a provider row", () => {
    const {queryByTestId} = renderWithTheme(
      <LinkedAccountsCard accounts={[GOOGLE, CREDENTIAL]} providers={PROVIDERS} />
    );
    expect(queryByTestId("linked-accounts-card-row-credential")).toBeNull();
  });

  it("lists a linked account whose provider the app no longer offers", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[CREDENTIAL, {accountId: "m-1", id: "acc-mock", providerId: "mock-oidc"}]}
        providers={PROVIDERS}
      />
    );
    expect(getByTestId("linked-accounts-card-row-mock-oidc")).toBeTruthy();
    expect(getByTestId("linked-accounts-card-name-mock-oidc").props.children).toBe("mock-oidc");
  });

  it("uses a provider's label for generic providers", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard accounts={[]} providers={[{id: "mock-oidc", label: "Company SSO"}]} />
    );
    expect(getByTestId("linked-accounts-card-name-mock-oidc").props.children).toBe("Company SSO");
  });

  it("omits the linked date when linkedAt is not a valid date", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[{...GOOGLE, linkedAt: "not-a-date"}, CREDENTIAL]}
        providers={PROVIDERS}
      />
    );
    const status = String(getByTestId("linked-accounts-card-status-google").props.children);
    expect(status).toBe("ada@example.com");
  });

  it("formats a Date linkedAt, as the Better Auth client returns it", () => {
    const linkedAt = new Date(LINKED_AT);
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[{id: "acc-gh", linkedAt, providerId: "github"}, CREDENTIAL]}
        providers={PROVIDERS}
      />
    );
    expect(getByTestId("linked-accounts-card-status-github").props.children).toBe(
      `Linked ${DateTime.fromJSDate(linkedAt).toLocaleString(DateTime.DATE_MED)}`
    );
  });

  it("gives each linked account of one provider its own unlinkable row", async () => {
    const work: LinkedAccount = {
      email: "ada@work.example",
      id: "acc-google-2",
      providerId: "google",
    };
    const onUnlink = mock((_providerId: string, _account: LinkedAccount) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, work, CREDENTIAL]}
        onLink={mock(() => Promise.resolve())}
        onUnlink={onUnlink}
        providers={PROVIDERS}
      />
    );
    expect(getByTestId("linked-accounts-card-unlink-google")).toBeTruthy();
    expect(getByTestId("linked-accounts-card-unlink-google-2")).toBeTruthy();
    expect(queryByTestId("linked-accounts-card-link-google")).toBeNull();
    expect(getByTestId("linked-accounts-card-link-github")).toBeTruthy();

    await press(getByTestId("linked-accounts-card-unlink-google-2"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-confirm-submit")).toBeTruthy();
    });
    await press(getByTestId("linked-accounts-card-confirm-submit"));
    await waitFor(() => {
      expect(onUnlink).toHaveBeenCalledWith("google", work);
    });
  });

  it("disables every button with the disabled prop", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        disabled
        onLink={mock(() => Promise.resolve())}
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(true);
    expect(isDisabled(getByTestId("linked-accounts-card-link-github"))).toBe(true);
  });

  it("shows a spinner on the unlinking row and disables the others until unlink settles", async () => {
    let resolveUnlink: () => void = () => {};
    const onUnlink = mock(
      (_providerId: string, _account: LinkedAccount) =>
        new Promise<void>((resolve) => {
          resolveUnlink = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onLink={mock(() => Promise.resolve())}
        onUnlink={onUnlink}
        providers={PROVIDERS}
      />
    );
    await press(getByTestId("linked-accounts-card-unlink-google"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-confirm-submit")).toBeTruthy();
    });
    await press(getByTestId("linked-accounts-card-confirm-submit"));
    await waitFor(() => {
      expect(onUnlink).toHaveBeenCalled();
    });
    const unlinkButton = getByTestId("linked-accounts-card-unlink-google");
    expect(isDisabled(unlinkButton)).toBe(true);
    expect(unlinkButton.findAllByType(ActivityIndicator).length).toBe(1);
    const linkButton = getByTestId("linked-accounts-card-link-github");
    expect(isDisabled(linkButton)).toBe(true);
    expect(linkButton.findAllByType(ActivityIndicator).length).toBe(0);

    await act(async () => {
      resolveUnlink();
    });
    await waitFor(() => {
      expect(isDisabled(getByTestId("linked-accounts-card-link-github"))).toBe(false);
    });
    expect(
      getByTestId("linked-accounts-card-unlink-google").findAllByType(ActivityIndicator).length
    ).toBe(0);
  });

  it("calls onLink with the provider id and shows a spinner on that row while pending", async () => {
    let resolveLink: () => void = () => {};
    const onLink = mock(
      (_providerId: string) =>
        new Promise<void>((resolve) => {
          resolveLink = resolve;
        })
    );
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard accounts={[CREDENTIAL]} onLink={onLink} providers={PROVIDERS} />
    );
    await press(getByTestId("linked-accounts-card-link-github"));
    expect(onLink).toHaveBeenCalledWith("github");
    await waitFor(() => {
      expect(isDisabled(getByTestId("linked-accounts-card-link-github"))).toBe(true);
      expect(isDisabled(getByTestId("linked-accounts-card-link-google"))).toBe(true);
    });
    await act(async () => {
      resolveLink();
    });
    await waitFor(() => {
      expect(isDisabled(getByTestId("linked-accounts-card-link-github"))).toBe(false);
    });
  });

  it("asks for confirmation before unlinking and unlinks on confirm", async () => {
    const onUnlink = mock((_providerId: string, _account: LinkedAccount) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onUnlink={onUnlink}
        providers={PROVIDERS}
      />
    );
    expect(queryByTestId("linked-accounts-card-confirm")).toBeNull();

    await press(getByTestId("linked-accounts-card-unlink-google"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-confirm")).toBeTruthy();
    });
    expect(onUnlink).not.toHaveBeenCalled();

    await press(getByTestId("linked-accounts-card-confirm-submit"));
    await waitFor(() => {
      expect(onUnlink).toHaveBeenCalledWith("google", GOOGLE);
    });
    await waitFor(() => {
      expect(queryByTestId("linked-accounts-card-confirm")).toBeNull();
    });
  });

  it("does not unlink when the confirmation is cancelled", async () => {
    const onUnlink = mock((_providerId: string, _account: LinkedAccount) => Promise.resolve());
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onUnlink={onUnlink}
        providers={PROVIDERS}
      />
    );
    await press(getByTestId("linked-accounts-card-unlink-google"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-confirm-cancel")).toBeTruthy();
    });
    await press(getByTestId("linked-accounts-card-confirm-cancel"));
    await waitFor(() => {
      expect(queryByTestId("linked-accounts-card-confirm")).toBeNull();
    });
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("disables Unlink with an explanation when it is the only sign-in method", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE]}
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(true);
    expect(getByTestId("linked-accounts-card-last-method-google")).toBeTruthy();
  });

  it("allows Unlink when the user also has a password", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(false);
    expect(queryByTestId("linked-accounts-card-last-method-google")).toBeNull();
  });

  it("counts passkeys passed as otherMethodCount as a sign-in method", () => {
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE]}
        onUnlink={mock(() => Promise.resolve())}
        otherMethodCount={1}
        providers={PROVIDERS}
      />
    );
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(false);
  });

  it("allows unlinking the last method with canUnlinkLast", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE]}
        canUnlinkLast
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(false);
    expect(queryByTestId("linked-accounts-card-last-method-google")).toBeNull();
  });

  it("shows a rejected unlink's message as an alert", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const onUnlink = mock((_providerId: string, _account: LinkedAccount) =>
      Promise.reject(new Error("You can't unlink your last account"))
    );
    const {getByTestId} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onUnlink={onUnlink}
        providers={PROVIDERS}
      />
    );
    await press(getByTestId("linked-accounts-card-unlink-google"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-confirm-submit")).toBeTruthy();
    });
    await press(getByTestId("linked-accounts-card-confirm-submit"));
    await waitFor(() => {
      expect(getByTestId("linked-accounts-card-error")).toBeTruthy();
    });
    expect(getByTestId("linked-accounts-card-error").props.role).toBe("alert");
    expect(isDisabled(getByTestId("linked-accounts-card-unlink-google"))).toBe(false);
    warn.mockRestore();
  });

  it("shows the error prop as an alert", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <LinkedAccountsCard accounts={[]} error="Linking failed" providers={PROVIDERS} />
    );
    expect(getByTestId("linked-accounts-card-error").props.role).toBe("alert");
    expect(getByText("Linking failed")).toBeTruthy();
  });

  it("names the Link and Unlink buttons after their provider", () => {
    const {getByLabelText} = renderWithTheme(
      <LinkedAccountsCard
        accounts={[GOOGLE, CREDENTIAL]}
        onLink={mock(() => Promise.resolve())}
        onUnlink={mock(() => Promise.resolve())}
        providers={PROVIDERS}
      />
    );
    expect(getByLabelText("Unlink Google (ada@example.com)")).toBeTruthy();
    expect(getByLabelText("Link GitHub")).toBeTruthy();
  });

  it("hides the buttons when no callbacks are given", () => {
    const {queryByTestId} = renderWithTheme(
      <LinkedAccountsCard accounts={[GOOGLE, CREDENTIAL]} providers={PROVIDERS} />
    );
    expect(queryByTestId("linked-accounts-card-unlink-google")).toBeNull();
    expect(queryByTestId("linked-accounts-card-link-github")).toBeNull();
  });
});
