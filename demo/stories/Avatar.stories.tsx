import {
  Avatar,
  type AvatarImagePickerEvent,
  type AvatarProps,
  Box,
  Heading,
  Text,
} from "@terreno/ui";
import {type ReactElement, useState} from "react";

export const AvatarDemo = (props: Partial<AvatarProps>) => {
  const [src, setSrc] = useState<string | undefined>(props.src ?? undefined);

  return (
    <Box>
      <Avatar
        hasBorder
        name="Tony Stark"
        src={src}
        status="online"
        {...props}
        onChange={(val: AvatarImagePickerEvent) => {
          setSrc(val.uri);
        }}
      />
    </Box>
  );
};

export const AvatarInitials = () => {
  return (
    <Box direction="column" display="flex">
      <Text>Tony Stark</Text>
      <Avatar hasBorder name="Tony Stark" status="online" />
      <Text>Tony Stark Jr</Text>
      <Avatar hasBorder name="Tony Stark Jr" status="online" />
      <Text>Tony Ironman Stark</Text>
      <Avatar hasBorder name="Tony Ironman Stark" status="online" />
      <Text>Tony</Text>
      <Avatar hasBorder name="Tony" status="online" />
      <Text> Tony Stark Colored</Text>
      <Avatar hasBorder name="Tony Stark" status="online" />
    </Box>
  );
};
export const AvatarSizes = () => {
  return (
    <Box direction="column" display="flex">
      <Text>XS</Text>
      <Avatar name="Tony Stark" size="xs" status="online" />
      <Text>SM</Text>
      <Avatar name="Tony Stark" size="sm" status="online" />
      <Text>MD</Text>
      <Avatar name="Tony Stark" size="md" status="online" />
      <Text>LG</Text>
      <Avatar name="Tony Stark" size="lg" status="online" />
      <Text>XL</Text>
      <Avatar name="Tony Stark" size="xl" status="online" />
    </Box>
  );
};
export const AvatarOutlines = () => {
  return (
    <Box color="baseAlternate" direction="column" display="flex">
      <Text>XS</Text>
      <Avatar name="Tony Stark" size="xs" status="online" />
      <Text>SM</Text>
      <Avatar name="Tony Stark" size="sm" status="online" />
      <Text>MD</Text>
      <Avatar name="Tony Stark" size="md" status="online" />
      <Text>LG</Text>
      <Avatar name="Tony Stark" size="lg" status="online" />
      <Text>XL</Text>
      <Avatar name="Tony Stark" size="xl" status="online" />
      <Text>XS</Text>
      <Avatar
        name="Tony Stark"
        size="xs"
        src="https://i.ibb.co/ZfCZrY8/keerthi.jpg"
        status="online"
      />
      <Text>SM</Text>
      <Avatar
        name="Tony Stark"
        size="sm"
        src="https://i.ibb.co/ZfCZrY8/keerthi.jpg"
        status="online"
      />
      <Text>MD</Text>
      <Avatar
        name="Tony Stark"
        size="md"
        src="https://i.ibb.co/ZfCZrY8/keerthi.jpg"
        status="online"
      />
      <Text>LG</Text>
      <Avatar
        name="Tony Stark"
        size="lg"
        src="https://i.ibb.co/ZfCZrY8/keerthi.jpg"
        status="online"
      />
      <Text>XL</Text>
      <Avatar
        name="Tony Stark"
        size="xl"
        src="https://i.ibb.co/ZfCZrY8/keerthi.jpg"
        status="online"
      />
    </Box>
  );
};

export const AvatarImage = (): ReactElement => {
  const [xlImage, setXLImage] = useState<AvatarImagePickerEvent>({
    height: 0,
    uri: "https://i.ibb.co/ZfCZrY8/keerthi.jpg",
    width: 0,
  });

  return (
    <Box scroll>
      <Heading>Image Picker is only available on XL Avatar</Heading>
      <Text>Width: {xlImage.width}</Text>
      <Text>Height: {xlImage.height}</Text>

      <Avatar
        hasBorder
        name="Tony Stark"
        onChange={(image) => setXLImage(image)}
        size="xl"
        src={xlImage.uri}
        status="imagePicker"
      />
    </Box>
  );
};
