import {describe, expect, it} from "bun:test";

import {Image} from "./Image";
import {renderWithTheme} from "./test-utils";

describe("Image", () => {
  it("renders correctly with naturalWidth", () => {
    const {toJSON} = renderWithTheme(
      <Image naturalWidth={200} src="https://example.com/image.jpg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly with fullWidth", () => {
    const {toJSON} = renderWithTheme(<Image fullWidth src="https://example.com/image.jpg" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with cover fit mode", () => {
    const {toJSON} = renderWithTheme(
      <Image fit="cover" naturalWidth={200} src="https://example.com/image.jpg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with contain fit mode", () => {
    const {toJSON} = renderWithTheme(
      <Image fit="contain" naturalWidth={200} src="https://example.com/image.jpg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with none fit mode", () => {
    const {toJSON} = renderWithTheme(
      <Image fit="none" naturalWidth={200} src="https://example.com/image.jpg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with maxWidth and maxHeight", () => {
    const {toJSON} = renderWithTheme(
      <Image
        maxHeight={300}
        maxWidth={400}
        naturalWidth={200}
        src="https://example.com/image.jpg"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with background color", () => {
    const {toJSON} = renderWithTheme(
      <Image color="secondaryDark" naturalWidth={200} src="https://example.com/image.jpg" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom style", () => {
    const {toJSON} = renderWithTheme(
      <Image naturalWidth={200} src="https://example.com/image.jpg" style={{borderRadius: 10}} />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
