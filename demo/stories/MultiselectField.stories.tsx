import {Box, isNarrowViewport, MultiselectField, type MultiselectFieldProps} from "@terreno/ui";

export const MultiselectFieldDemo = (props: Partial<MultiselectFieldProps>) => {
  return (
    <Box alignItems="center" justifyContent="center">
      <Box padding={3} width="100%">
        <MultiselectField
          onChange={() => console.info("selected")}
          options={[
            {label: "Option 1", value: "Option 1"},
            {label: "Option 2", value: "Option 2"},
            {label: "Option 3", value: "Option 3"},
          ]}
          title="Multiselect Field"
          value={["Option 1"]}
          {...props}
        />
      </Box>
    </Box>
  );
};

export const MultiselectVariants = () => {
  const isMobile = isNarrowViewport();
  return (
    <Box width={isMobile ? undefined : "30%"}>
      <Box padding={3}>
        <MultiselectField
          onChange={() => console.info("selected")}
          options={[
            {label: "Option 1", value: "Option 1"},
            {label: "Option 2", value: "Option 2"},
            {label: "Option 3", value: "Option 3"},
          ]}
          title='Default - Variant "leftText"'
          value={["Option 1"]}
        />
      </Box>
      <Box padding={3}>
        <MultiselectField
          onChange={() => console.info("selected")}
          options={[
            {label: "Option 1", value: "Option 1"},
            {label: "Option 2", value: "Option 2"},
            {label: "Option 3", value: "Option 3"},
          ]}
          title='Variant "rightText"'
          value={["Option 1"]}
          variant="rightText"
        />
      </Box>
      <Box padding={3}>
        <MultiselectField
          disabled
          onChange={() => console.info("selected")}
          options={[
            {label: "Option 1", value: "Option 1"},
            {label: "Option 2", value: "Option 2"},
            {label: "Option 3", value: "Option 3"},
          ]}
          title="Disabled State"
          value={["Option 1", "Option 2"]}
          variant="rightText"
        />
      </Box>
    </Box>
  );
};
