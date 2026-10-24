import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";

import {SocialLoginButton} from "./SocialLoginButton";
import {renderWithTheme} from "./test-utils";

describe("SocialLoginButton", () => {
  const createMockOnPress = () => mock(() => Promise.resolve());

  it("renders correctly with Google provider", () => {
    const onPress = createMockOnPress();
    const {toJSON} = renderWithTheme(<SocialLoginButton onPress={onPress} provider="google" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly with GitHub provider", () => {
    const onPress = createMockOnPress();
    const {toJSON} = renderWithTheme(<SocialLoginButton onPress={onPress} provider="github" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly with Apple provider", () => {
    const onPress = createMockOnPress();
    const {toJSON} = renderWithTheme(<SocialLoginButton onPress={onPress} provider="apple" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("displays default text for each provider", () => {
    const onPress = createMockOnPress();

    const {getByText: getGoogleText} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" />
    );
    expect(getGoogleText("Continue with Google")).toBeTruthy();

    const {getByText: getGitHubText} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="github" />
    );
    expect(getGitHubText("Continue with GitHub")).toBeTruthy();

    const {getByText: getAppleText} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="apple" />
    );
    expect(getAppleText("Continue with Apple")).toBeTruthy();
  });

  it("displays custom text when provided", () => {
    const onPress = createMockOnPress();
    const customText = "Sign in with Google";

    const {getByText} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" text={customText} />
    );

    expect(getByText(customText)).toBeTruthy();
  });

  it("renders with outline variant", () => {
    const onPress = createMockOnPress();
    const {toJSON} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" variant="outline" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onPress when button is pressed", async () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" testID="google-login" />
    );

    const button = getByTestId("google-login");
    fireEvent.press(button);

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(onPress).toHaveBeenCalled();
  });

  it("disables button when disabled prop is true", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton disabled onPress={onPress} provider="google" />
    );

    const button = getByTestId("social-login-google");
    expect(button.props.disabled).toBe(true);
  });

  it("disables button when loading is true", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton loading onPress={onPress} provider="google" />
    );

    const button = getByTestId("social-login-google");
    expect(button.props.disabled).toBe(true);
  });

  it("follows later changes to the loading prop", () => {
    const onPress = createMockOnPress();
    const {getByTestId, rerender} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" />
    );
    expect(getByTestId("social-login-google").props.disabled).toBeFalsy();

    rerender(<SocialLoginButton loading onPress={onPress} provider="google" />);
    expect(getByTestId("social-login-google").props.disabled).toBe(true);

    rerender(<SocialLoginButton loading={false} onPress={onPress} provider="google" />);
    expect(getByTestId("social-login-google").props.disabled).toBeFalsy();
  });

  it("uses correct testID", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" testID="custom-test-id" />
    );

    expect(getByTestId("custom-test-id")).toBeTruthy();
  });

  it("uses default testID based on provider", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="github" />
    );

    expect(getByTestId("social-login-github")).toBeTruthy();
  });

  it("renders full width by default", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" />
    );

    const button = getByTestId("social-login-google");
    expect(button).toHaveStyle({width: "100%"});
  });

  it("renders auto width when fullWidth is false", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton fullWidth={false} onPress={onPress} provider="google" />
    );

    const button = getByTestId("social-login-google");
    expect(button).toHaveStyle({width: "auto"});
  });

  it("has correct accessibility label", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" text="Sign in with Google" />
    );

    const button = getByTestId("social-login-google");
    expect(button.props["aria-label"]).toBe("Sign in with Google");
  });

  it("has correct accessibility hint", () => {
    const onPress = createMockOnPress();
    const {getByTestId} = renderWithTheme(
      <SocialLoginButton onPress={onPress} provider="google" />
    );

    const button = getByTestId("social-login-google");
    expect(button.props.accessibilityHint).toBe("Sign in with Google");
  });
});
