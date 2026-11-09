import {Box, Button, WhatsNewBanner, type WhatsNewRelease} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

const RELEASES: WhatsNewRelease[] = [
  {
    body: "### Fixed\n\n- Primary button labels are white again in light mode.",
    date: "2026-10-13",
    version: "57.16.2",
  },
  {
    body: "### Added\n\n- A Terraform module that provisions a Terreno backend on Cloud Run.",
    date: "2026-10-12",
    version: "57.16.1",
  },
];

export const WhatsNewBannerDemo: React.FC = (): React.ReactElement => {
  // A fresh key per reset brings the banner back after it is dismissed or opened.
  const [resetCount, setResetCount] = useState(0);
  const handleReset = useCallback((): void => {
    setResetCount((count) => count + 1);
  }, []);

  return (
    <Box gap={2}>
      <WhatsNewBanner
        key={resetCount}
        releases={RELEASES}
        storageKey={`demo:whatsNew:${resetCount}`}
      />
      <Button onClick={handleReset} text="Show again" variant="outline" />
    </Box>
  );
};

export const WhatsNewBannerSingleRelease: React.FC = (): React.ReactElement => {
  return <WhatsNewBanner releases={RELEASES.slice(0, 1)} storageKey="demo:whatsNew:single" />;
};
