import {describe, expect, it, mock} from "bun:test";
import {renderWithTheme} from "../test-utils";
import {OAuthButtons} from "./OAuthButtons";

describe("OAuthButtons", () => {
  const mockProviders = [
    {onPress: mock(() => Promise.resolve()), provider: "google" as const},
    {onPress: mock(() => Promise.resolve()), provider: "github" as const},
    {onPress: mock(() => Promise.resolve()), provider: "apple" as const},
  ];

  it("renders all provider buttons", () => {
    const {getByTestId} = renderWithTheme(
      <OAuthButtons providers={mockProviders} testID="oauth" />
    );
    expect(getByTestId("oauth")).toBeTruthy();
    expect(getByTestId("oauth-google")).toBeTruthy();
    expect(getByTestId("oauth-github")).toBeTruthy();
    expect(getByTestId("oauth-apple")).toBeTruthy();
  });

  it("renders nothing when providers is empty", () => {
    const {queryByTestId} = renderWithTheme(<OAuthButtons providers={[]} testID="oauth" />);
    expect(queryByTestId("oauth")).toBeNull();
  });

  it("renders with custom divider text", () => {
    const {getByText} = renderWithTheme(
      <OAuthButtons dividerText="Sign in with" providers={mockProviders} />
    );
    expect(getByText("Sign in with")).toBeTruthy();
  });

  it("renders default divider text", () => {
    const {getByText} = renderWithTheme(<OAuthButtons providers={mockProviders} />);
    expect(getByText("Or continue with")).toBeTruthy();
  });

  it("renders correctly with all props", () => {
    const {toJSON} = renderWithTheme(
      <OAuthButtons disabled providers={mockProviders} testID="oauth" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders generic providers without branded ones", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <OAuthButtons
        genericProviders={[
          {id: "mock-oidc", label: "Mock OIDC", onPress: mock(() => Promise.resolve())},
        ]}
        providers={[]}
        testID="oauth"
      />
    );
    expect(getByTestId("oauth-mock-oidc")).toBeTruthy();
    expect(getByText("Continue with Mock OIDC")).toBeTruthy();
  });

  it("badges the last-used provider with a default testID", () => {
    const {getAllByTestId, getByTestId, getByText} = renderWithTheme(
      <OAuthButtons lastUsed={{provider: "apple"}} providers={mockProviders} testID="oauth" />
    );
    expect(getByTestId("oauth-apple-last-used")).toBeTruthy();
    expect(getByText("Last used")).toBeTruthy();
    expect(getByTestId("oauth-apple").props["aria-label"]).toBe("Continue with Apple, last used");
    const order = getAllByTestId(/^oauth-(google|github|apple)$/).map(
      (element) => element.props.testID
    );
    expect(order).toEqual(["oauth-apple", "oauth-google", "oauth-github"]);
  });
});
