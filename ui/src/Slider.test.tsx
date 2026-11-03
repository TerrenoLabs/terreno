import {describe, expect, it, mock} from "bun:test";

import {Slider} from "./Slider";
import {renderWithTheme} from "./test-utils";

describe("Slider", () => {
  describe("basic rendering", () => {
    it("should render with default props", () => {
      const mockOnChange = mock(() => {});
      const {root} = renderWithTheme(
        <Slider maximumValue={100} minimumValue={0} onChange={mockOnChange} value={50} />
      );
      expect(root).toBeTruthy();
    });

    it("should render with title", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          title="Volume"
          value={50}
        />
      );
      expect(getByText("Volume")).toBeTruthy();
    });

    it("should render with helper text", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          helperText="Adjust the volume"
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(getByText("Adjust the volume")).toBeTruthy();
    });

    it("should render with error text", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          errorText="Value is required"
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(getByText("Value is required")).toBeTruthy();
    });
  });

  describe("showSelection", () => {
    it("should display the current value when showSelection is true", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={1}
          value={50}
        />
      );
      expect(getByText("50")).toBeTruthy();
    });

    it("should format decimal values correctly", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          maximumValue={1}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={0.1}
          value={0.5}
        />
      );
      expect(getByText("0.5")).toBeTruthy();
    });
  });

  describe("labels", () => {
    it("should render min and max labels", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          labels={{max: "High", min: "Low"}}
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(getByText("Low")).toBeTruthy();
      expect(getByText("High")).toBeTruthy();
    });

    it("should render inline labels", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          inlineLabels
          labels={{max: "Max", min: "Min"}}
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(getByText("Min")).toBeTruthy();
      expect(getByText("Max")).toBeTruthy();
    });
  });

  describe("valueMapping", () => {
    it("should display mapped label for current value", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={25}
          value={50}
          valueMapping={[
            {label: "Low", value: 0},
            {label: "Medium", value: 50},
            {label: "High", value: 100},
          ]}
        />
      );
      expect(getByText("Medium")).toBeTruthy();
    });
  });

  describe("snapshots", () => {
    it("should match snapshot with default props", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider maximumValue={100} minimumValue={0} onChange={mockOnChange} value={50} />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with title and showSelection", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={1}
          title="Volume Control"
          value={75}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with labels", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          labels={{max: "High", min: "Low"}}
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with inline labels", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          inlineLabels
          labels={{max: "100%", min: "0%"}}
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with helper text", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          helperText="Drag to adjust"
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          title="Brightness"
          value={50}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot with error text", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          errorText="Please select a value"
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          title="Required Field"
          value={0}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });

    it("should match snapshot when disabled", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          disabled
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={1}
          title="Disabled Slider"
          value={50}
        />
      );
      expect(toJSON()).toMatchSnapshot();
    });
  });

  describe("advanced branches", () => {
    it("renders icon-based value mapping when useIcons is true", () => {
      const mockOnChange = mock(() => {});
      const {toJSON} = renderWithTheme(
        <Slider
          maximumValue={2}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={1}
          useIcons
          value={1}
          valueMapping={[
            {label: "face-frown", size: "md", value: 0},
            {label: "face-meh", size: "lg", value: 1},
            {label: "face-smile", size: "xl", value: 2},
          ]}
        />
      );
      expect(toJSON()).toBeTruthy();
    });

    it("renders custom labels alongside min and max labels", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          labels={{
            custom: [{index: 0.5, label: "Middle"}],
            max: "High",
            min: "Low",
          }}
          maximumValue={100}
          minimumValue={0}
          onChange={mockOnChange}
          value={50}
        />
      );
      expect(getByText("Low")).toBeTruthy();
      expect(getByText("Middle")).toBeTruthy();
      expect(getByText("High")).toBeTruthy();
    });

    it("falls back to plain numeric formatter when valueMapping is empty", () => {
      const mockOnChange = mock(() => {});
      const {getByText} = renderWithTheme(
        <Slider
          maximumValue={10}
          minimumValue={0}
          onChange={mockOnChange}
          showSelection
          step={1}
          value={7}
          valueMapping={[]}
        />
      );
      expect(getByText("7")).toBeTruthy();
    });
  });
});
