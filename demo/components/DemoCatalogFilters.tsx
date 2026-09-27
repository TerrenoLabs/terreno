import {Box, Button, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";

const DEMO_CATEGORIES = [
  "All",
  "Foundation",
  "Component",
  "Pattern",
  "Data Entry",
  "Form",
] as const;

export const DemoCatalogFilters: React.FC<{
  category: string;
  onCategoryChange: (category: string) => void;
  onQueryChange: (query: string) => void;
  query: string;
}> = ({category, onCategoryChange, onQueryChange, query}) => {
  const handleQueryChange = useCallback(
    (value: string): void => {
      onQueryChange(value);
    },
    [onQueryChange]
  );
  const handleCategoryChange = useCallback(
    (value: string): void => {
      onCategoryChange(value);
    },
    [onCategoryChange]
  );

  return (
    <Box
      direction="column"
      gap={2}
      margin={2}
      mdDirection="row"
      testID="demo-catalog-filters"
      width="100%"
    >
      <Box flex="grow" minWidth={220}>
        <TextField
          onChange={handleQueryChange}
          placeholder="Search components"
          testID="demo-search"
          title="Search"
          value={query}
        />
      </Box>
      <Box direction="row" gap={2} testID="demo-categories" wrap>
        {DEMO_CATEGORIES.map((item) => (
          <Button
            key={item}
            onClick={() => {
              handleCategoryChange(item);
            }}
            testID={`demo-category-${item}`}
            text={item}
            variant={item === category ? "primary" : "outline"}
          />
        ))}
      </Box>
    </Box>
  );
};
