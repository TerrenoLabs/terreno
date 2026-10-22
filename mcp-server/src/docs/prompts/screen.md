# Screen Generation

Create a new screen with the following specifications:

## Screen Details
- **Name**: {{name}}
- **Type**: {{type}}
- **Route**: {{route}}

## Features
{{featuresList}}

## Implementation Requirements

### File Structure
- Create screen at `app/{{route}}.tsx`
- Add any shared components to `components/`

### Required Elements
1. Use `Page` component as wrapper
2. Include proper navigation title
3. Handle empty states (synced collection reads are local and have no loading state)
4. Handle loading and error states for request hooks from `store/apiSdk.ts` with `Spinner` and an error message
5. Use @terreno/ui components throughout

### Data Fetching
{{dataSection}}

Synced collections read with `useQuery` / `useEntity` and write with `useMutate` from
`@terreno/syncdb/react`. Every other route uses the generated hooks in `store/apiSdk.ts`.

### Example Structure
```tsx
import {useQuery} from "@terreno/syncdb/react";
import {Box, Page, Text} from "@terreno/ui";
import type React from "react";
import type {{{Model}}} from "@/types/{{model}}";

const {{Name}}Screen: React.FC = () => {
  const rows = useQuery<{{Model}}>("{{collection}}", {sort: "-created"});

  if (rows.length === 0) {
    return (
      <Page navigation={undefined} title="{{title}}">
        <Box padding={4}>
          <Text>Nothing here yet</Text>
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} title="{{title}}">
      <Box padding={4} gap={4}>
        {/* Screen content */}
      </Box>
    </Page>
  );
};

export default {{Name}}Screen;
```

### Navigation
- Add to tab layout if needed in `app/(tabs)/_layout.tsx`
- Or add as stack screen in appropriate layout
