import {describe, expect, it, mock} from "bun:test";
import type {ScaledSize} from "react-native";
import {useWindowDimensions} from "react-native";
import type {ReactTestRendererJSON} from "react-test-renderer";

import {Card} from "./Card";
import {SkeletonCircle} from "./Skeleton";
import {Text} from "./Text";
import {renderWithTheme} from "./test-utils";

// Skeletons are hidden from assistive tech, so queries opt in to hidden elements.
const HIDDEN = {includeHiddenElements: true};

type WindowDimensionsImpl = () => ScaledSize;
type MockableUseWindowDimensions = WindowDimensionsImpl & {
  mockImplementation?: (impl: WindowDimensionsImpl) => void;
};

const getScaledSize =
  (width: number): WindowDimensionsImpl =>
  (): ScaledSize => ({
    fontScale: 1,
    height: 1000,
    scale: 2,
    width,
  });

const setWindowWidth = (width: number): (() => void) => {
  const useWindowDimensionsMock = useWindowDimensions as MockableUseWindowDimensions;
  const dimensionsImpl = getScaledSize(width);

  if (typeof useWindowDimensionsMock.mockImplementation === "function") {
    useWindowDimensionsMock.mockImplementation(dimensionsImpl);

    return (): void => {
      useWindowDimensionsMock.mockImplementation?.(getScaledSize(375));
    };
  }

  return (): void => {};
};

describe("Card", () => {
  describe("container variant (default)", () => {
    it("renders correctly with default props", () => {
      const {toJSON} = renderWithTheme(
        <Card>
          <Text>Card content</Text>
        </Card>
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("renders children correctly", () => {
      const {getByText} = renderWithTheme(
        <Card>
          <Text>Test content</Text>
        </Card>
      );
      expect(getByText("Test content")).toBeTruthy();
    });

    it("applies custom padding", () => {
      const {toJSON} = renderWithTheme(
        <Card padding={8}>
          <Text>Content</Text>
        </Card>
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("applies custom color", () => {
      const {toJSON} = renderWithTheme(
        <Card color="secondaryDark">
          <Text>Content</Text>
        </Card>
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("passes additional Box props", () => {
      const {toJSON} = renderWithTheme(
        <Card gap={2} marginTop={4}>
          <Text>Content</Text>
        </Card>
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("renders with testID", () => {
      const {getByTestId} = renderWithTheme(
        <Card testID="test-card">
          <Text>Content</Text>
        </Card>
      );
      expect(getByTestId("test-card")).toBeTruthy();
    });
  });

  describe("display variant", () => {
    it("renders correctly with required props", () => {
      const {toJSON} = renderWithTheme(<Card title="Feature Title" variant="display" />);
      expect(toJSON()).toMatchSnapshot();
    });

    it("renders title", () => {
      const {getByText} = renderWithTheme(<Card title="My Feature" variant="display" />);
      expect(getByText("My Feature")).toBeTruthy();
    });

    it("renders description when provided", () => {
      const {getByText} = renderWithTheme(
        <Card description="Check out this new feature" title="My Feature" variant="display" />
      );
      expect(getByText("Check out this new feature")).toBeTruthy();
    });

    it("uses 8px spacing between the title and description", () => {
      const {toJSON} = renderWithTheme(
        <Card description="Body text" title="Feature Title" variant="display" />
      );
      const json = toJSON() as ReactTestRendererJSON;
      const contentBox = json.children?.[0] as ReactTestRendererJSON;
      const titleDescriptionBox = contentBox.children?.[0] as ReactTestRendererJSON;

      expect(titleDescriptionBox.props.style.gap).toBe(8);
    });

    it("uses a 600px width for the default display card size on desktop", () => {
      const restoreWindowWidth = setWindowWidth(1024);
      const {toJSON} = renderWithTheme(<Card title="Feature Title" variant="display" />);
      const json = toJSON() as ReactTestRendererJSON;

      restoreWindowWidth();

      expect(json.props.style.width).toBe(600);
    });

    it("renders action button when buttonText and buttonOnClick are provided", () => {
      const onClick = mock(() => {});
      const {getByText} = renderWithTheme(
        <Card
          buttonOnClick={onClick}
          buttonText="Learn More"
          title="My Feature"
          variant="display"
        />
      );
      expect(getByText("Learn More")).toBeTruthy();
    });

    it("does not render button when only buttonText is provided", () => {
      const {queryByText} = renderWithTheme(
        <Card buttonText="Learn More" title="My Feature" variant="display" />
      );
      expect(queryByText("Learn More")).toBeNull();
    });

    it("renders children below structured content", () => {
      const {getByText} = renderWithTheme(
        <Card title="My Feature" variant="display">
          <Text>Extra content</Text>
        </Card>
      );
      expect(getByText("Extra content")).toBeTruthy();
    });

    it("renders image when imageUri is provided", () => {
      const {toJSON} = renderWithTheme(
        <Card
          imageAlt="Test image"
          imageUri="https://example.com/img.jpg"
          title="My Feature"
          variant="display"
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("renders with testID", () => {
      const {getByTestId} = renderWithTheme(
        <Card testID="display-card" title="My Feature" variant="display" />
      );
      expect(getByTestId("display-card")).toBeTruthy();
    });
  });

  describe("loading", () => {
    it("renders a card skeleton with media for a display card with an image", () => {
      const {getByTestId, queryByText} = renderWithTheme(
        <Card
          description="Description"
          imageUri="https://example.com/image.png"
          loading
          testID="card"
          title="Title"
          variant="display"
        />
      );
      expect(queryByText("Title")).toBeNull();
      expect(getByTestId("card").props["aria-busy"]).toBe(true);
    });

    it("sizes the media skeleton to the large mobile image height", () => {
      const {UNSAFE_root} = renderWithTheme(
        <Card
          imageUri="https://example.com/image.png"
          loading
          size="large"
          testID="card"
          title="Title"
          variant="display"
        />
      );
      const mediaBlocks = UNSAFE_root.findAll(
        (node) => node.props["aria-hidden"] === true && node.props.style?.height === 300
      );
      expect(mediaBlocks.length).toBeGreaterThan(0);
    });

    it("renders a custom loading component in a container card", () => {
      const {getByTestId, queryByText} = renderWithTheme(
        <Card loading loadingComponent={<SkeletonCircle testID="circle" />}>
          <Text>Body</Text>
        </Card>
      );
      expect(getByTestId("circle", HIDDEN)).toBeTruthy();
      expect(queryByText("Body")).toBeNull();
    });
  });
});
