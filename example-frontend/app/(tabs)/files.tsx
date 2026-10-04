import {DocumentStorageBrowser} from "@terreno/admin-frontend";
import {selectBetterAuthUserId, useFeatureFlags} from "@terreno/rtk";
import {router} from "expo-router";
import type React from "react";
import {useCallback} from "react";
import {useSelector} from "react-redux";

import {fileUploadsEnabledFromFlags} from "@/lib/fileUploads";
import {terrenoApi} from "@/store/sdk";

const FilesScreen: React.FC = () => {
  const userId = useSelector(selectBetterAuthUserId);
  const {flags, isLoading} = useFeatureFlags(terrenoApi, {skip: !userId, userId});
  const allowUpload = fileUploadsEnabledFromFlags({flags, isLoading});
  const handleSettingsPress = useCallback(() => {
    router.push("/gcs-settings");
  }, []);

  return (
    <DocumentStorageBrowser
      allowUpload={allowUpload}
      api={terrenoApi}
      basePath="/documents"
      onSettingsPress={handleSettingsPress}
      title="Files"
    />
  );
};

export default FilesScreen;
