import {Box} from "@terreno/ui";
import type {FC} from "react";

import {ChartVisualGallery} from "../../chartVisual/ChartVisualGallery";

const ChartVisualGalleryPage: FC = () => {
  return (
    <Box flex="grow" height="100%" scroll width="100%">
      <ChartVisualGallery />
    </Box>
  );
};

export default ChartVisualGalleryPage;
