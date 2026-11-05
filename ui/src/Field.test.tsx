import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";

import {Field} from "./Field";
import {renderWithTheme} from "./test-utils";

describe("Field", () => {
  it("renders text field by default", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders text field with type text", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="text" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders password field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="password" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("reveals the password value from the visibility toggle", () => {
    const {getByDisplayValue, getByTestId} = renderWithTheme(
      <Field onChange={() => {}} testID="field-password" type="password" value="hunter2" />
    );

    expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(true);

    fireEvent.press(getByTestId("field-password.visibility-toggle"));
    expect(getByDisplayValue("hunter2").props.secureTextEntry).toBe(false);
  });

  it("renders email field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="email" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders url field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="url" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders number field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="number" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders textarea field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="textarea" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders boolean field", () => {
    const handleChange = mock((_value: boolean) => {});
    const {toJSON} = renderWithTheme(
      <Field onChange={handleChange} type="boolean" value={false} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders date field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="date" value={undefined} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders time field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="time" value={undefined} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders datetime field", () => {
    const {toJSON} = renderWithTheme(
      <Field onChange={() => {}} type="datetime" value={undefined} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders select field", () => {
    const {toJSON} = renderWithTheme(
      <Field
        onChange={() => {}}
        options={[
          {label: "USA", value: "us"},
          {label: "Canada", value: "ca"},
        ]}
        type="select"
        value=""
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders multiselect field", () => {
    const {toJSON} = renderWithTheme(
      <Field
        onChange={() => {}}
        options={[
          {label: "JavaScript", value: "js"},
          {label: "Python", value: "py"},
        ]}
        title="Skills"
        type="multiselect"
        value={[]}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders address field", () => {
    const {toJSON} = renderWithTheme(
      <Field
        onChange={() => {}}
        type="address"
        value={{address1: "", city: "", state: "", zipcode: ""}}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders phoneNumber field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="phoneNumber" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders customSelect field", () => {
    const {toJSON} = renderWithTheme(
      <Field
        onChange={() => {}}
        options={[
          {label: "Option A", value: "a"},
          {label: "Option B", value: "b"},
        ]}
        type="customSelect"
        value="a"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders signature field", () => {
    const {toJSON} = renderWithTheme(<Field onChange={() => {}} type="signature" value="" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
