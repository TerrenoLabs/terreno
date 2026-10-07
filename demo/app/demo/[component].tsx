import {DemoPreviewFrame} from "@components/DemoPreviewFrame";
import {ErrorBoundary} from "@components/ErrorBoundary";
import {RelatedComponents} from "@components/RelatedComponents";
import {UsageSnippet} from "@components/UsageSnippet";
import {
  DemoConfig,
  type DemoConfigStatus,
  type DemoConfiguration,
  type DemoConfigurationProp,
  findDemoConfig,
} from "@config";
import {useEmbedMode} from "@contexts/EmbedModeContext";
import {
  Box,
  DataTable,
  Field,
  Heading,
  Icon,
  type IconName,
  Link,
  Text,
  type TextColor,
} from "@terreno/ui";
import {router, useLocalSearchParams, useNavigation} from "expo-router";
import cloneDeep from "lodash/cloneDeep";
import startCase from "lodash/startCase";
import type React from "react";
import {type FC, useEffect, useState} from "react";
import {Linking, Pressable} from "react-native";
import MarkdownView, {type MarkdownProps} from "react-native-markdown-display";
import {controlDefault, storiesForDemo} from "../../catalogContract";
import {formatPropComment, formatPropType} from "../../formatPropType";

// Raw markdown paragraphs are a row. Give them a bounded width so long lines wrap
// inside the page instead of stretching the demo column past the viewport.
const demoMarkdownStyle = {
  body: {maxWidth: "100%", minWidth: 0, width: "100%"},
  paragraph: {
    flexDirection: "column" as const,
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  textgroup: {flexShrink: 1, maxWidth: "100%", minWidth: 0, width: "100%"},
} as MarkdownProps["style"];

export const generateStaticParams = () => DemoConfig.map((c) => ({component: c.name}));

const ComponentProps = ({props}: {props: DemoConfigurationProp[]}) => {
  if (!props?.length) {
    return null;
  }

  const sortedProps = [...props].sort((a, b) => {
    if (a.flags.isOptional !== b.flags.isOptional) {
      return a.flags.isOptional ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });

  const columns = [
    {columnType: "text", title: "Name", width: 180},
    {columnType: "text", title: "Type", width: 300},
    {columnType: "text", title: "Required", width: 100},
    {columnType: "text", title: "Description", width: 350},
  ];

  const data = sortedProps.map((p) => [
    {value: p.name},
    {value: formatPropType(p.type)},
    {value: p.flags?.isOptional ? "" : "Required"},
    {value: formatPropComment(p.comment?.summary)},
  ]);

  return (
    <Box marginBottom={4}>
      <Box marginBottom={2}>
        <Heading>Props</Heading>
      </Box>
      <DataTable
        alternateRowBackground
        columns={columns}
        data={data}
        defaultTextSize="sm"
        rowHeight={40}
      />
    </Box>
  );
};

const ComponentStories: FC<{config: DemoConfiguration}> = ({config}) => {
  if (!Object.keys(config.stories).length) {
    return null;
  }
  return (
    <Box>
      {Object.keys(storiesForDemo(config.stories ?? {})).map(
        (s, i): React.ReactElement => (
          <Box key={i} marginBottom={8} rounding="lg">
            <Box marginBottom={2}>
              <Heading size="sm">{s}</Heading>
            </Box>
            {Boolean(config.stories[s]?.description) && (
              <MarkdownView style={demoMarkdownStyle}>
                {config.stories[s]?.description}
              </MarkdownView>
            )}
            <Box border="dark" maxWidth="100%" minWidth={0} padding={4} rounding="lg" width="100%">
              <ErrorBoundary>{config.stories[s]?.render()}</ErrorBoundary>
            </Box>
          </Box>
        )
      )}
    </Box>
  );
};

// const ComponentTestMatrix = ({config}: {config: DemoConfiguration}): React.ReactElement | null => {
//   // TODO: accordion this whole thing, default folded up, just for testing.
//   // noExplicitAny: Dead commented-out code; types for testMatrix values and return type cannot be resolved without the full uncommented context
//   function generateCombinations(testMatrix: {[prop: string]: any[]}): any[] {
//     const keys = Object.keys(testMatrix);
//     // noExplicitAny: Dead commented-out code; prevCombination shape depends on dynamic testMatrix keys
//     const generate = (objIndex: number, prevCombination: any): any[] => {
//       if (objIndex === keys.length) {
//         return [prevCombination];
//       }
//
//       const key = keys[objIndex];
//       const values = testMatrix[key];
//       // noExplicitAny: Dead commented-out code; combination type depends on dynamic testMatrix keys
//       const allCombinations: any[] = [];
//
//       for (const value of values) {
//         const combination = {...prevCombination, [key]: value};
//         const combinationsFromHere = generate(objIndex + 1, combination);
//         allCombinations.push(...combinationsFromHere);
//       }
//
//       return allCombinations;
//     };
//
//     return generate(0, {});
//   }
//
//   // noExplicitAny: Dead commented-out code; combination type depends on dynamic testMatrix keys
//   const combinations: any[] = [];
//
//   // noExplicitAny: Dead commented-out code; combination values are dynamic from testMatrix
//   const generateTitleForCombination = (combination: {[prop: string]: any}): string =>
//     Object.entries(combination)
//       .map(([key, value]) => `${key}: ${value}`)
//       .join(" - ");
//
//   const Component = config.component;
//
//   return (
//     <Box>
//       <Box marginBottom={4}>
//         <Heading>Testing Matrix</Heading>
//       </Box>
//       {combinations.map((combo) => (
//         <Box key={generateTitleForCombination(combo)} marginBottom={2}>
//           <Box marginBottom={1}>
//             <Heading size="sm">{generateTitleForCombination(combo)}</Heading>
//           </Box>
//           <Component {...combo} />
//         </Box>
//       ))}
//     </Box>
//   );
// };

const ComponentDemo = ({config}: {config: DemoConfiguration}) => {
  const convertControls = (
    controls: Record<string, {defaultValue?: unknown}>
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    Object.keys(controls).forEach((key) => {
      result[key] = controlDefault(controls[key] ?? {});
    });
    return result;
  };

  const [propValues, setPropValues] = useState(convertControls(config.demoOptions?.controls ?? {}));

  const hasControls = Object.keys(config.demoOptions?.controls ?? {}).length > 0;

  return (
    <Box
      direction="column"
      marginBottom={2}
      maxWidth="100%"
      mdDirection="row"
      minWidth={0}
      width="100%"
    >
      <Box
        alignItems="center"
        border="dark"
        direction="column"
        flex="grow"
        justifyContent="center"
        marginBottom={4}
        marginLeft={2}
        marginRight={2}
        maxWidth="100%"
        minWidth={0}
        padding={4}
        rounding="lg"
        width="100%"
      >
        <ErrorBoundary>{config.demo?.(propValues)}</ErrorBoundary>
      </Box>
      {Boolean(hasControls) && (
        <Box
          border="dark"
          direction="column"
          flex="grow"
          marginBottom={4}
          marginLeft={2}
          marginRight={2}
          padding={4}
          rounding="lg"
        >
          {Object.keys(propValues).map((prop) => (
            <Field
              key={prop}
              title={config.demoOptions?.controls?.[prop]?.title ?? startCase(prop)}
              {...(config.demoOptions?.controls?.[prop] as Record<string, unknown>)}
              onChange={(value: unknown) => {
                setPropValues({...cloneDeep(propValues), [prop]: value});
              }}
              value={propValues[prop] as string}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

const ComponentStatusSection: FC<{
  href?: string;
  status: DemoConfigStatus;
  title: string;
}> = ({href, status, title}) => {
  let iconName: IconName = "circle";
  let color: TextColor = "secondaryLight";
  switch (status) {
    case "inProgress":
      iconName = "circle";
      break;
    case "ready":
      iconName = "circle-check";
      color = "success";
      break;
    case "notSupported":
      iconName = "circle-xmark";
      color = "error";
      break;
    case "planned":
      iconName = "calendar";
      break;
  }

  const content = (
    <Box alignItems="center" direction="row" marginBottom={2} marginRight={4}>
      <Box marginRight={1}>
        <Text color={href ? "link" : undefined} underline={Boolean(href)}>
          {title}:
        </Text>
      </Box>
      <Icon color={color} iconName={iconName} size="md" />
    </Box>
  );

  if (href) {
    return <Pressable onPress={() => Linking.openURL(href)}>{content}</Pressable>;
  }
  return content;
};

const ComponentStatus: FC<{config: DemoConfiguration}> = ({config}) => {
  return (
    <Box marginBottom={4} marginTop={4}>
      <Box marginBottom={2}>
        <Heading size="sm">Status</Heading>
      </Box>
      <Box direction="column" mdDirection="row">
        <ComponentStatusSection status={config.status.documentation} title="Documentation" />
        <ComponentStatusSection
          href={config.status.figmaLink}
          status={config.status.figma}
          title="Figma"
        />
        <ComponentStatusSection status={config.status.web} title="Web" />
        <ComponentStatusSection status={config.status.ios} title="iOS" />
        <ComponentStatusSection status={config.status.android} title="Android" />
      </Box>
    </Box>
  );
};

const ComponentUsage: FC<{config: DemoConfiguration}> = ({config}) => {
  if (!config.usage.do.length && !config.usage.doNot.length) {
    return null;
  }
  return (
    <Box marginBottom={4}>
      <Box marginBottom={2}>
        <Heading size="sm">Usage Guidelines</Heading>
      </Box>
      <Box direction="column" gap={4} mdDirection="row">
        {Boolean(config.usage.do.length) && (
          <Box flex="grow">
            <Box marginBottom={1}>
              <Text bold color="success">
                Do
              </Text>
            </Box>
            {config.usage.do.map((item, i) => (
              <Box direction="row" key={i} marginBottom={1}>
                <Box marginRight={1} style={{paddingTop: 4}}>
                  <Icon color="success" iconName="circle-check" size="sm" />
                </Box>
                <Box flex="shrink">
                  <Text>{item}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {Boolean(config.usage.doNot.length) && (
          <Box flex="grow">
            <Box marginBottom={1}>
              <Text bold color="error">
                Don't
              </Text>
            </Box>
            {config.usage.doNot.map((item, i) => (
              <Box direction="row" key={i} marginBottom={1}>
                <Box marginRight={1} style={{paddingTop: 4}}>
                  <Icon color="error" iconName="circle-xmark" size="sm" />
                </Box>
                <Box flex="shrink">
                  <Text>{item}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const ComponentA11yNotes: FC<{config: DemoConfiguration}> = ({config}) => {
  if (!config.a11yNotes.length) {
    return null;
  }
  return (
    <Box marginBottom={4}>
      <Box marginBottom={2}>
        <Heading size="sm">Accessibility</Heading>
      </Box>
      {config.a11yNotes.map((note, i) => (
        <Box direction="row" key={i} marginBottom={1}>
          <Box marginRight={1} style={{paddingTop: 4}}>
            <Icon color="secondaryLight" iconName="universal-access" size="sm" />
          </Box>
          <Box flex="shrink">
            <Text>{note}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

const ComponentAdditionalDocs: FC<{config: DemoConfiguration}> = ({config}) => {
  if (!config.additionalDocumentation?.length) {
    return null;
  }
  return (
    <Box marginBottom={4}>
      <Box marginBottom={2}>
        <Heading size="sm">Additional Documentation</Heading>
      </Box>
      {config.additionalDocumentation.map((doc, i) => (
        <Box alignItems="center" direction="row" key={i} marginBottom={1}>
          <Box marginRight={1}>
            <Icon color="secondaryLight" iconName="arrow-up-right-from-square" size="sm" />
          </Box>
          <Link href={doc.link} text={doc.name} />
        </Box>
      ))}
    </Box>
  );
};

const ComponentPage: FC = () => {
  const {component} = useLocalSearchParams<{component: string}>();
  const {isEmbedMode} = useEmbedMode();
  const navigation = useNavigation();

  const config = findDemoConfig(component);

  // Redirect to /demo if the component doesn't exist. This must be an effect (not an
  // early return before the hooks below) so every render calls the same hooks in the
  // same order — otherwise switching between two component demos without unmounting
  // (expo-router reuses this component instance) throws "Rendered fewer hooks than expected."
  useEffect(() => {
    if (!component || !config) {
      router.replace("/demo");
    }
  }, [component, config]);

  // Set the title from the configured name so a lowercased deep link still shows real casing
  useEffect(() => {
    if (config) {
      navigation.setOptions({title: config.name});
    }
  }, [navigation, config]);

  if (!component || !config) {
    return null;
  }

  if (isEmbedMode) {
    return (
      <DemoPreviewFrame>
        <Box padding={2} width="100%">
          <ComponentDemo config={config} key={config.name} />
        </Box>
      </DemoPreviewFrame>
    );
  }

  return (
    <DemoPreviewFrame>
      <Box flex="grow" height="100%" maxWidth="100%" minWidth={0} padding={4} scroll width="100%">
        <Box maxWidth="100%" minWidth={0} width="100%">
          <Box marginBottom={4}>
            <Heading size="lg">{config?.name}</Heading>
          </Box>
          <Box marginBottom={4} maxWidth="100%" minWidth={0} width="100%">
            <Box marginBottom={2}>
              <Heading size="sm">Description</Heading>
            </Box>
            <MarkdownView style={demoMarkdownStyle}>{config?.description}</MarkdownView>
          </Box>
          <ComponentDemo config={config} key={config.name} />
          {config.usageExample ? <UsageSnippet example={config.usageExample} /> : null}
          <ComponentUsage config={config!} />
          <ComponentA11yNotes config={config!} />
          <ComponentProps props={config?.props?.children} />
          <ComponentStatus config={config!} />
          <ComponentAdditionalDocs config={config!} />
          {Boolean(config?.related.length) && (
            <Box marginBottom={4}>
              <Box marginBottom={2}>
                <Heading size="sm">Related</Heading>
              </Box>
              <RelatedComponents names={config.related} />
            </Box>
          )}
          <Box marginBottom={2}>
            <Heading size="sm">Examples</Heading>
          </Box>
          <ComponentStories config={config!} />
          {/* <ComponentTestMatrix config={config} /> */}
        </Box>
      </Box>
    </DemoPreviewFrame>
  );
};

export default ComponentPage;
