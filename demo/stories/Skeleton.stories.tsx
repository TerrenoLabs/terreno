import {
  Avatar,
  Box,
  Button,
  Card,
  Heading,
  Scorecard,
  Skeleton,
  type SkeletonAnimation,
  SkeletonCard,
  SkeletonCircle,
  SkeletonList,
  SkeletonText,
  Text,
  withLoading,
} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";

import {StorybookContainer} from "./StorybookContainer";

const ANIMATIONS: SkeletonAnimation[] = ["pulse", "shimmer", "none"];

interface ProfileRowProps {
  email: string;
  name: string;
  testID?: string;
}

const ProfileRow: React.FC<ProfileRowProps> = ({email, name, testID}) => (
  <Box alignItems="center" direction="row" gap={3} testID={testID}>
    <Avatar name={name} size="md" />
    <Box direction="column">
      <Text bold>{name}</Text>
      <Text color="secondaryDark">{email}</Text>
    </Box>
  </Box>
);

const ProfileRowWithLoading = withLoading(ProfileRow, {
  loadingComponent: <SkeletonList rows={1} />,
});

const useLoadingToggle = (): {isLoading: boolean; toggle: () => void} => {
  const [isLoading, setIsLoading] = useState(true);
  const toggle = useCallback((): void => setIsLoading((value) => !value), []);
  return {isLoading, toggle};
};

const LoadingToggle: React.FC<{isLoading: boolean; onClick: () => void; testID: string}> = ({
  isLoading,
  onClick,
  testID,
}) => (
  <Box alignSelf="start">
    <Button
      onClick={onClick}
      testID={testID}
      text={isLoading ? "Show content" : "Show loading"}
      variant="secondary"
    />
  </Box>
);

export const SkeletonDemo = (props: {animation?: SkeletonAnimation}): React.ReactElement => {
  return (
    <Box direction="column" gap={4} testID="skeleton-demo" width="100%">
      <Skeleton animation={props.animation} height={24} width="40%" />
      <SkeletonText animation={props.animation} />
      <SkeletonCircle animation={props.animation} />
    </Box>
  );
};

export const SkeletonShapes = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box direction="column" gap={6} testID="skeleton-shapes" width="100%">
        <Box direction="column" gap={2}>
          <Heading size="sm">Skeleton</Heading>
          <Skeleton height={120} rounding="md" />
        </Box>
        <Box direction="column" gap={2}>
          <Heading size="sm">SkeletonText</Heading>
          <SkeletonText lines={4} />
        </Box>
        <Box direction="column" gap={2}>
          <Heading size="sm">SkeletonCircle</Heading>
          <Box direction="row" gap={3}>
            <SkeletonCircle size={24} />
            <SkeletonCircle />
            <SkeletonCircle size={64} />
          </Box>
        </Box>
        <Box direction="column" gap={2}>
          <Heading size="sm">SkeletonCard</Heading>
          <SkeletonCard showMedia />
        </Box>
        <Box direction="column" gap={2}>
          <Heading size="sm">SkeletonList</Heading>
          <SkeletonList rows={3} />
        </Box>
      </Box>
    </StorybookContainer>
  );
};

export const SkeletonAnimations = (): React.ReactElement => {
  return (
    <StorybookContainer>
      <Box direction="column" gap={6} testID="skeleton-animations" width="100%">
        {ANIMATIONS.map((animation) => (
          <Box direction="column" gap={2} key={animation}>
            <Heading size="sm">{animation}</Heading>
            <SkeletonCard animation={animation} testID={`skeleton-animation-${animation}`} />
          </Box>
        ))}
      </Box>
    </StorybookContainer>
  );
};

export const BoxLoading = (): React.ReactElement => {
  const {isLoading, toggle} = useLoadingToggle();

  return (
    <StorybookContainer>
      <Box direction="column" gap={4} testID="skeleton-box-loading" width="100%">
        <LoadingToggle isLoading={isLoading} onClick={toggle} testID="skeleton-box-toggle" />
        <Box
          border="default"
          direction="column"
          gap={2}
          loading={isLoading}
          loadingAnimation="shimmer"
          loadingComponent={<SkeletonList rows={2} />}
          loadingLabel="Loading team"
          padding={4}
          rounding="md"
          testID="skeleton-box"
        >
          <ProfileRow email="ada@example.com" name="Ada Lovelace" />
          <ProfileRow email="grace@example.com" name="Grace Hopper" />
        </Box>
      </Box>
    </StorybookContainer>
  );
};

export const CardLoading = (): React.ReactElement => {
  const {isLoading, toggle} = useLoadingToggle();

  return (
    <StorybookContainer>
      <Box direction="column" gap={4} testID="skeleton-card-loading" width="100%">
        <LoadingToggle isLoading={isLoading} onClick={toggle} testID="skeleton-card-toggle" />
        <Card
          buttonOnClick={toggle}
          buttonText="Read more"
          description="Display cards swap to a SkeletonCard by default, with media when the card has an image."
          imageUri="https://picsum.photos/seed/terreno/600/320"
          loading={isLoading}
          testID="skeleton-display-card"
          title="Display card"
          variant="display"
        />
        <Scorecard
          loading={isLoading}
          sparklineData={[
            {label: "Mon", value: 12},
            {label: "Tue", value: 18},
            {label: "Wed", value: 9},
          ]}
          testID="skeleton-scorecard"
          title="Weekly visits"
          value={1280}
        />
      </Box>
    </StorybookContainer>
  );
};

export const CustomComponentLoading = (): React.ReactElement => {
  const {isLoading, toggle} = useLoadingToggle();

  return (
    <StorybookContainer>
      <Box direction="column" gap={4} testID="skeleton-custom-loading" width="100%">
        <LoadingToggle isLoading={isLoading} onClick={toggle} testID="skeleton-custom-toggle" />
        <ProfileRowWithLoading
          email="ada@example.com"
          loading={isLoading}
          name="Ada Lovelace"
          testID="skeleton-profile-row"
        />
      </Box>
    </StorybookContainer>
  );
};
