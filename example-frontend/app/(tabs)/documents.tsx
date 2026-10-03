import {ConsentHistory, DocumentStorageBrowser} from "@terreno/admin-frontend";
import {Box, SegmentedControl} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {useSafeAreaInsets} from "react-native-safe-area-context";

import {DocumentsPdfSection} from "@/components/DocumentsPdfSection";
import {terrenoApi} from "@/store/sdk";

// Section order drives both the segmented control labels and the `section` query param.
const SECTIONS = [
  {key: "files", label: "Files"},
  {key: "consents", label: "Consents"},
  {key: "pdf", label: "PDF"},
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

const sectionIndexFor = (section: string | string[] | undefined): number => {
  const value = Array.isArray(section) ? section[0] : section;
  const index = SECTIONS.findIndex((s) => s.key === value);
  return index === -1 ? 0 : index;
};

const DocumentsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const {section} = useLocalSearchParams<{section?: string | string[]}>();
  const selectedIndex = sectionIndexFor(section);
  const selectedKey: SectionKey = SECTIONS[selectedIndex].key;

  const handleSectionChange = useCallback((index: number): void => {
    router.setParams({section: SECTIONS[index].key});
  }, []);

  const handleSettingsPress = useCallback((): void => {
    router.push("/gcs-settings");
  }, []);

  return (
    <Box flex="grow" testID="documents-screen">
      <Box paddingX={4} paddingY={2} style={{paddingTop: insets.top + 8}}>
        <SegmentedControl
          items={SECTIONS.map((s) => s.label)}
          onChange={handleSectionChange}
          selectedIndex={selectedIndex}
          testID="documents-section-control"
        />
      </Box>
      <Box flex="grow">
        {selectedKey === "files" && (
          <DocumentStorageBrowser
            api={terrenoApi}
            backButton={false}
            basePath="/documents"
            onSettingsPress={handleSettingsPress}
            title="Files"
          />
        )}
        {selectedKey === "consents" && <ConsentHistory api={terrenoApi} />}
        {selectedKey === "pdf" && <DocumentsPdfSection />}
      </Box>
    </Box>
  );
};

export default DocumentsScreen;
