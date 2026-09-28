import {DemoPreviewFrame} from "@components/DemoPreviewFrame";
import {ErrorBoundary} from "@components/ErrorBoundary";
import {DemoConfig, findDemoConfig} from "@config";
import {Box} from "@terreno/ui";
import {router, useLocalSearchParams, useNavigation} from "expo-router";
import {type FC, useEffect} from "react";

export const generateStaticParams = () => DemoConfig.map((c) => ({component: c.name}));

const DevComponentPage: FC = () => {
  const {component, story} = useLocalSearchParams<{component: string; story?: string}>();

  const config = findDemoConfig(component);

  const navigation = useNavigation();
  // Set the title
  useEffect(() => {
    navigation.setOptions({title: story});
  }, [navigation, story]);

  // Redirect to /dev when the story can't be resolved. Kept in an effect so the hooks above
  // always run in the same order, and paired with the early return below so the render never
  // reads stories off a missing config.
  useEffect(() => {
    if (!story || !config) {
      router.replace("/dev");
    }
  }, [config, story]);

  if (!story || !config) {
    return null;
  }

  return (
    <DemoPreviewFrame>
      <Box flex="grow" height="100%" width="100%">
        <ErrorBoundary>{config.stories[story]?.render()}</ErrorBoundary>
      </Box>
    </DemoPreviewFrame>
  );
};

export default DevComponentPage;
