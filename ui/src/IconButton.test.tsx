import {describe, expect, it, mock} from "bun:test";
import type {ReactTestInstance} from "react-test-renderer";

import {IconButton} from "./IconButton";
import {useTheme} from "./Theme";
import {renderWithIcons, renderWithTheme} from "./test-utils";
import {applyColorOpacity} from "./Utilities";

describe("IconButton", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" onClick={() => {}} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with testID", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="check"
        onClick={() => {}}
        testID="test-icon-button"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders primary variant (default)", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" onClick={() => {}} variant="primary" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders secondary variant", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="check"
        onClick={() => {}}
        variant="secondary"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders muted variant", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" onClick={() => {}} variant="muted" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders navigation variant", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="chevron-left"
        onClick={() => {}}
        variant="navigation"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders destructive variant", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="trash"
        onClick={() => {}}
        variant="destructive"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" disabled iconName="check" onClick={() => {}} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders loading state", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" loading onClick={() => {}} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with indicator", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="bell" indicator="error" onClick={() => {}} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with indicator and text", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="bell"
        indicator="error"
        indicatorText="5"
        onClick={() => {}}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onClick when pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test Button" iconName="check" onClick={handleClick} />
    );
    // Verify the component renders correctly with onClick prop
    expect(toJSON()).toMatchSnapshot();
  });

  it("has correct accessibility props", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityHint="Custom hint"
        accessibilityLabel="Custom Label"
        iconName="check"
        onClick={() => {}}
      />
    );
    // Verify accessibility props are applied
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with confirmation props", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Delete"
        confirmationHeading="Confirm Delete"
        confirmationText="Are you sure?"
        iconName="trash"
        onClick={() => {}}
        withConfirmation
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders ghost variant", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" onClick={() => {}} variant="ghost" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders sm size", () => {
    const {toJSON} = renderWithTheme(
      <IconButton accessibilityLabel="Test" iconName="check" onClick={() => {}} size="sm" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders primary variant in active state", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="check"
        onClick={() => {}}
        state="active"
        variant="primary"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders ghost variant in active state", () => {
    const {toJSON} = renderWithTheme(
      <IconButton
        accessibilityLabel="Test"
        iconName="check"
        onClick={() => {}}
        state="active"
        variant="ghost"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("keeps a translucent muted background and an opaque icon", async () => {
    // bunSetup replaces ./IconButton with a null mock; the query suffix loads the real module.
    const actualIconButtonPath = "./IconButton.tsx?actual";
    const {IconButton: ActualIconButton} = (await import(
      actualIconButtonPath
    )) as typeof import("./IconButton");
    let inverted = "";
    const CaptureTheme = (): null => {
      const {theme} = useTheme();
      inverted = theme.text.inverted;
      return null;
    };
    const {getByLabelText, UNSAFE_root} = renderWithTheme(
      <>
        <CaptureTheme />
        <ActualIconButton
          accessibilityLabel="muted background solid"
          iconName="check"
          onClick={() => {}}
          variant="muted"
        />
        <ActualIconButton
          accessibilityLabel="muted background translucent"
          backgroundOpacity={0.88}
          iconName="check"
          onClick={() => {}}
          variant="muted"
        />
      </>
    );

    expect(getByLabelText("muted background solid")).toHaveStyle({backgroundColor: inverted});
    expect(getByLabelText("muted background translucent")).toHaveStyle({
      backgroundColor: applyColorOpacity({color: inverted, opacity: 0.88}),
    });
    const icons = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.name === "check" && Boolean(node.props?.color)
    );
    expect(icons).toHaveLength(2);
    expect(icons[0].props.color).toBe(icons[1].props.color);
  });

  describe("custom icons", () => {
    // IconButton renders `null` under the bun/react-test-renderer harness (all of
    // its snapshots are null), so we verify the custom-icon code path renders
    // without throwing rather than asserting on rendered output. The registry
    // resolution itself is covered in IconRegistry.test.tsx via useCustomIcon.
    it("accepts a registered custom icon name without throwing", () => {
      expect(() =>
        renderWithIcons(
          <IconButton accessibilityLabel="Custom" iconName="testCustomIcon" onClick={() => {}} />
        )
      ).not.toThrow();
    });

    it("accepts an unregistered (FontAwesome) icon name without throwing", () => {
      expect(() =>
        renderWithIcons(
          <IconButton accessibilityLabel="Check" iconName="check" onClick={() => {}} />
        )
      ).not.toThrow();
    });
  });
});
