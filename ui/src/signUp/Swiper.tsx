import {type FC, memo} from "react";
import {Image} from "react-native";
import {SwiperFlatList} from "react-native-swiper-flatlist";

import {Box} from "../Box";
import {Heading} from "../Heading";
import {Text} from "../Text";
import type {OnboardingPage} from "./signUpTypes";

interface SwiperProps {
  /** Onboarding pages to display. */
  pages: OnboardingPage[];
  /** Test ID prefix for the component. */
  testID?: string;
}

/**
 * An onboarding swiper that displays pages with optional images, titles, and subtitles.
 * Memoized so a parent form does not re-render every page on each keystroke.
 */
export const Swiper: FC<SwiperProps> = memo(({pages, testID = "onboarding-swiper"}) => {
  if (pages.length === 0) {
    return null;
  }

  return (
    <Box height={300} testID={testID} width="100%">
      <SwiperFlatList autoplay autoplayDelay={4} autoplayLoop showPagination>
        {pages.map((page, index) => (
          <Box
            alignItems="center"
            justifyContent="center"
            key={`${page.title}-${index}`}
            padding={4}
            width="100%"
          >
            {Boolean(page.image) && (
              <Image
                resizeMode="contain"
                source={page.image!}
                style={{height: 120, marginBottom: 16, width: 120}}
              />
            )}
            {Boolean(page.content) && page.content}
            <Heading align="center" size="md">
              {page.title}
            </Heading>
            {Boolean(page.subtitle) && (
              <Box marginTop={2}>
                <Text align="center" color="secondaryLight">
                  {page.subtitle}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </SwiperFlatList>
    </Box>
  );
});
Swiper.displayName = "Swiper";
