import {
  Box,
  CheckBox,
  DropdownPanel,
  FilterAccordion,
  FilterBoolean,
  FilterSelectMenu,
  Text,
} from "@terreno/ui";
import type React from "react";
import {useState} from "react";
import {Pressable} from "react-native";

import {StorybookContainer} from "./StorybookContainer";

const DATE_OPTIONS = [
  {label: "All", value: "all"},
  {label: "Today", value: "today"},
  {label: "This week", value: "week"},
  {label: "This month", value: "month"},
  {label: "Overdue", value: "overdue"},
];

const STATUS_OPTIONS = ["Incomplete", "In progress", "Complete", "Not applicable"];

// Full compositional filter panel mirroring the To Do's reference implementation.
export const DropdownPanelDemo = (): React.ReactElement => {
  const [dateRange, setDateRange] = useState("all");
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);

  const toggleStatus = (status: string): void => {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  return (
    <StorybookContainer>
      <DropdownPanel
        onApply={() => console.info("Applied", {assignedToMe, dateRange, statuses, urgentOnly})}
        onClear={() => {
          setDateRange("all");
          setAssignedToMe(false);
          setUrgentOnly(false);
          setStatuses([]);
        }}
      >
        <FilterSelectMenu
          onChange={setDateRange}
          options={DATE_OPTIONS}
          showChangesBadge={dateRange !== "all"}
          title="Due date"
          value={dateRange}
        />
        <FilterBoolean
          onChange={setAssignedToMe}
          showChangesBadge={assignedToMe}
          title="Assigned to me only"
          value={assignedToMe}
        />
        <FilterBoolean
          onChange={setUrgentOnly}
          showChangesBadge={urgentOnly}
          title="Urgent tasks only"
          value={urgentOnly}
        />
        <FilterAccordion defaultExpanded showChangesBadge={statuses.length > 0} title="Status">
          <Box direction="column" gap={2}>
            {STATUS_OPTIONS.map((status) => {
              const checked = statuses.includes(status);
              // Pressable does not type the web `onKeyDown`, but RN Web forwards it.
              const webKeyDownProps = {
                onKeyDown: (event: {key: string; preventDefault: () => void}) => {
                  if (event.key === " " || event.key === "Spacebar") {
                    event.preventDefault();
                    toggleStatus(status);
                  }
                },
              };
              return (
                <Pressable
                  key={status}
                  {...webKeyDownProps}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked}}
                  aria-checked={checked}
                  onPress={() => toggleStatus(status)}
                  style={{alignItems: "center", flexDirection: "row", gap: 8}}
                >
                  <CheckBox selected={checked} />
                  <Text>{status}</Text>
                </Pressable>
              );
            })}
          </Box>
        </FilterAccordion>
      </DropdownPanel>
    </StorybookContainer>
  );
};

// Compositional dropdown panel without the Apply/Clear/Cancel footer.
export const DropdownPanelNoActionsDemo = (): React.ReactElement => {
  const [assignedToMe, setAssignedToMe] = useState(false);
  return (
    <StorybookContainer>
      <DropdownPanel label="Filters" showActionButtons={false}>
        <FilterBoolean
          onChange={setAssignedToMe}
          showChangesBadge={assignedToMe}
          title="Assigned to me only"
          value={assignedToMe}
        />
      </DropdownPanel>
    </StorybookContainer>
  );
};

// Each sub-component rendered on its own for state review.
export const DropdownPanelSubComponentsDemo = (): React.ReactElement => {
  const [dateRange, setDateRange] = useState("all");
  const [toggle, setToggle] = useState(true);
  const [expanded, setExpanded] = useState(false);
  return (
    <StorybookContainer>
      <Box direction="column" gap={4} width={320}>
        <Text bold>Select menu</Text>
        <FilterSelectMenu
          onChange={setDateRange}
          options={DATE_OPTIONS}
          showChangesBadge={dateRange !== "all"}
          title="Due date"
          value={dateRange}
        />
        <Text bold>Boolean (on / off / disabled)</Text>
        <FilterBoolean onChange={setToggle} title="Urgent only" value={toggle} />
        <FilterBoolean disabled onChange={() => {}} title="Locked filter" value />
        <Text bold>Accordion</Text>
        <FilterAccordion expanded={expanded} onToggle={setExpanded} showChangesBadge title="Status">
          <Text>Custom content goes here.</Text>
        </FilterAccordion>
      </Box>
    </StorybookContainer>
  );
};
