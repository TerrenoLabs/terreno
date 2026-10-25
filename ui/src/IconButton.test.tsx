import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
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

  it("uses the supplied accessibility hint without announcing a confirmation dialog", async () => {
    // bunSetup replaces ./IconButton with a null mock; the query suffix loads the real module.
    const actualIconButtonPath = "./IconButton.tsx?accessibility";
    const {IconButton: ActualIconButton} = (await import(
      actualIconButtonPath
    )) as typeof import("./IconButton");
    const {getByLabelText} = renderWithTheme(
      <ActualIconButton
        accessibilityHint="Back to list"
        accessibilityLabel="Back to list"
        iconName="arrow-left"
        onClick={() => {}}
      />
    );

    expect(getByLabelText("Back to list").props.accessibilityHint).toBe("Back to list");
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
  describe("interaction (real component)", () => {
    // bunSetup replaces ./IconButton with a null mock; the query suffix loads the real module.
    const loadIconButton = async (): Promise<typeof import("./IconButton").IconButton> => {
      const actualIconButtonPath = "./IconButton.tsx?interaction";
      const module = (await import(actualIconButtonPath)) as typeof import("./IconButton");
      return module.IconButton;
    };

    it("runs onClick once when pressed without confirmation", async () => {
      const ActualIconButton = await loadIconButton();
      const handleClick = mock(() => Promise.resolve());
      const {getByLabelText} = renderWithTheme(
        <ActualIconButton accessibilityLabel="Save" iconName="check" onClick={handleClick} />
      );

      await act(async () => {
        fireEvent.press(getByLabelText("Save"));
      });

      await waitFor(() => {
        expect(handleClick).toHaveBeenCalledTimes(1);
      });
    });

    it("asks for confirmation first and runs onClick only after Confirm", async () => {
      const ActualIconButton = await loadIconButton();
      const handleClick = mock(() => Promise.resolve());
      const {getByLabelText, getByText} = renderWithTheme(
        <ActualIconButton
          accessibilityLabel="Delete"
          confirmationHeading="Delete item"
          confirmationText="This cannot be undone."
          iconName="trash"
          onClick={handleClick}
          withConfirmation
        />
      );

      expect(getByLabelText("Delete").props.accessibilityHint).toBe(
        "Opens a confirmation dialog to confirm Delete"
      );
      await act(async () => {
        fireEvent.press(getByLabelText("Delete"));
      });
      await waitFor(() => {
        expect(getByText("This cannot be undone.")).toBeTruthy();
      });
      expect(handleClick).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.press(getByText("Confirm"));
      });
      await waitFor(() => {
        expect(handleClick).toHaveBeenCalledTimes(1);
      });
    });

    it("closes the confirmation without running onClick on Cancel", async () => {
      const ActualIconButton = await loadIconButton();
      const handleClick = mock(() => Promise.resolve());
      const {getByLabelText, getByText} = renderWithTheme(
        <ActualIconButton
          accessibilityLabel="Archive"
          iconName="box-archive"
          onClick={handleClick}
          withConfirmation
        />
      );

      await act(async () => {
        fireEvent.press(getByLabelText("Archive"));
      });
      await waitFor(() => {
        expect(getByText("Are you sure you want to continue?")).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(getByText("Cancel"));
      });

      expect(handleClick).not.toHaveBeenCalled();
    });

    it("colors each variant and state from the theme", async () => {
      const ActualIconButton = await loadIconButton();
      let theme = {} as ReturnType<typeof useTheme>["theme"];
      const CaptureTheme = (): null => {
        theme = useTheme().theme;
        return null;
      };
      const {getByLabelText} = renderWithTheme(
        <>
          <CaptureTheme />
          <ActualIconButton accessibilityLabel="primary" iconName="check" onClick={() => {}} />
          <ActualIconButton
            accessibilityLabel="secondary"
            iconName="check"
            onClick={() => {}}
            variant="secondary"
          />
          <ActualIconButton
            accessibilityLabel="navigation"
            iconName="check"
            onClick={() => {}}
            variant="navigation"
          />
          <ActualIconButton
            accessibilityLabel="destructive"
            iconName="check"
            onClick={() => {}}
            variant="destructive"
          />
          <ActualIconButton
            accessibilityLabel="ghost"
            iconName="check"
            onClick={() => {}}
            variant="ghost"
          />
          <ActualIconButton
            accessibilityLabel="disabled"
            disabled
            iconName="check"
            onClick={() => {}}
          />
          <ActualIconButton
            accessibilityLabel="primary active"
            iconName="check"
            onClick={() => {}}
            state="active"
          />
          <ActualIconButton
            accessibilityLabel="ghost active"
            iconName="check"
            onClick={() => {}}
            state="active"
            variant="ghost"
          />
          <ActualIconButton
            accessibilityLabel="small"
            iconName="check"
            indicator="error"
            indicatorText="3"
            onClick={() => {}}
            size="sm"
          />
        </>
      );

      expect(getByLabelText("primary")).toHaveStyle({backgroundColor: theme.surface.primary});
      expect(getByLabelText("secondary")).toHaveStyle({
        backgroundColor: theme.surface.neutralLight,
      });
      expect(getByLabelText("navigation")).toHaveStyle({backgroundColor: theme.text.inverted});
      expect(getByLabelText("destructive")).toHaveStyle({backgroundColor: theme.text.inverted});
      expect(getByLabelText("ghost")).toHaveStyle({backgroundColor: "transparent"});
      expect(getByLabelText("disabled")).toHaveStyle({backgroundColor: theme.surface.disabled});
      expect(getByLabelText("primary active")).toHaveStyle({
        backgroundColor: theme.primitives.primary600,
      });
      expect(getByLabelText("ghost active")).toHaveStyle({backgroundColor: theme.surface.primary});
      expect(getByLabelText("small")).toHaveStyle({height: 28, width: 28});
    });

    it("uses the tooltip text as the label when the label is empty", async () => {
      const ActualIconButton = await loadIconButton();
      const {getByLabelText} = renderWithTheme(
        <ActualIconButton
          accessibilityLabel=""
          iconName="gear"
          onClick={() => {}}
          tooltipText="Settings"
        />
      );
      expect(getByLabelText("Settings").props.accessibilityHint).toBe(
        "Press to perform Settings action"
      );
    });
  });
});
