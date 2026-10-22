import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {TextField} from "../TextField";
import {renderWithTheme} from "../test-utils";
import {defaultPasswordRequirements} from "./passwordPresets";
import {SignUpScreen} from "./SignUpScreen";

const defaultFields = [
  {label: "Name", name: "name", required: true, type: "text" as const},
  {label: "Email", name: "email", required: true, type: "email" as const},
  {label: "Password", name: "password", required: true, type: "password" as const},
];

describe("SignUpScreen", () => {
  it("renders with default props", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen")).toBeTruthy();
  });

  it("renders title", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-title")).toBeTruthy();
  });

  it("renders custom title", () => {
    const {getByText} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        title="Join Us"
      />
    );
    expect(getByText("Join Us")).toBeTruthy();
  });

  it("renders all form fields", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-name-input")).toBeTruthy();
    expect(getByTestId("signup-screen-email-input")).toBeTruthy();
    expect(getByTestId("signup-screen-password-input")).toBeTruthy();
  });

  it("renders submit button", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    expect(getByTestId("signup-screen-submit-button")).toBeTruthy();
  });

  it("renders login link when onLoginPress is provided", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onLoginPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-login-link")).toBeTruthy();
  });

  it("renders error message", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        error="Something went wrong"
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-error")).toBeTruthy();
  });

  it("renders password requirements when provided", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        passwordRequirements={defaultPasswordRequirements}
      />
    );
    expect(getByTestId("signup-screen-password-requirements")).toBeTruthy();
  });

  it("renders OAuth buttons when providers are given", () => {
    const providers = [{onPress: mock(() => Promise.resolve()), provider: "google" as const}];
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        oauthProviders={providers}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    expect(getByTestId("signup-screen-oauth")).toBeTruthy();
  });

  it("updates form field values on change", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen fields={defaultFields} onSubmit={mock(() => Promise.resolve())} />
    );
    const nameInput = getByTestId("signup-screen-name-input");
    fireEvent.changeText(nameInput, "John Doe");
    expect(nameInput.props.value).toBe("John Doe");
  });

  it("renders with custom testID", () => {
    const {getByTestId} = renderWithTheme(
      <SignUpScreen
        fields={defaultFields}
        onSubmit={mock(() => Promise.resolve())}
        testID="custom-signup"
      />
    );
    expect(getByTestId("custom-signup")).toBeTruthy();
  });

  it("renders correctly with all props", () => {
    const {toJSON} = renderWithTheme(
      <SignUpScreen
        error="Error!"
        fields={defaultFields}
        loading
        onLoginPress={() => {}}
        onSubmit={mock(() => Promise.resolve())}
        passwordRequirements={defaultPasswordRequirements}
        title="Sign Up"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("hints new-password on password fields unless the field sets its own", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(
      <SignUpScreen
        fields={[
          {autoComplete: "email", label: "Email", name: "email", type: "email"},
          {label: "Password", name: "password", type: "password"},
        ]}
        onSubmit={mock(() => Promise.resolve())}
      />
    );
    const [email, password] = UNSAFE_getAllByType(TextField);
    expect(email.props.autoComplete).toBe("email");
    expect(password.props.autoComplete).toBe("new-password");
  });
});
