import {Box, Button, type ButtonPressAnimation, type ButtonProps, Heading, Text} from "@terreno/ui";
import type React from "react";

interface ButtonAnimationExample {
  description: string;
  label: string;
  value: ButtonPressAnimation;
}

interface ButtonVariantExample {
  iconName?: ButtonProps["iconName"];
  text: string;
  variant?: ButtonProps["variant"];
}

const BUTTON_PRESS_ANIMATIONS: ButtonAnimationExample[] = [
  {
    description: "Pressto PressableScale compresses the button while pressed.",
    label: "Scale",
    value: "scale",
  },
  {
    description: "Pressto PressableOpacity fades the button while pressed.",
    label: "Opacity",
    value: "opacity",
  },
  {
    description: "Pressto PressableWithoutFeedback keeps behavior without visual motion.",
    label: "None",
    value: "none",
  },
];

const BUTTON_VARIANT_EXAMPLES: ButtonVariantExample[] = [
  {iconName: "bolt", text: "Primary", variant: "primary"},
  {iconName: "star", text: "Secondary", variant: "secondary"},
  {iconName: "border-all", text: "Outline", variant: "outline"},
  {iconName: "leaf", text: "Muted", variant: "muted"},
  {iconName: "trash", text: "Destructive", variant: "destructive"},
  {iconName: "ghost", text: "Ghost", variant: "ghost"},
];

const BUTTON_STATE_VARIANTS: {label: string; variant: ButtonProps["variant"]}[] = [
  {label: "Primary", variant: "primary"},
  {label: "Secondary", variant: "secondary"},
  {label: "Outline", variant: "outline"},
  {label: "Muted", variant: "muted"},
  {label: "Destructive", variant: "destructive"},
  {label: "Ghost", variant: "ghost"},
];

const handleDemoClick = (): void => {
  console.info("clicked");
};

export const ButtonDemo: React.FC<Partial<ButtonProps>> = (props) => {
  return (
    <Box alignItems="center" justifyContent="center">
      <Button
        iconName="plus"
        onClick={handleDemoClick}
        testID="demo-button"
        text="Button"
        {...props}
      />
    </Box>
  );
};

export const ButtonVariants: React.FC<Partial<ButtonProps>> = (props = {}) => {
  return (
    <>
      <Box direction="row" wrap>
        <Box padding={1}>
          <Button
            onClick={handleDemoClick}
            testID="button-variant-primary"
            text="Default/Primary"
            {...props}
          />
        </Box>
        <Box padding={1}>
          <Button onClick={handleDemoClick} text="Secondary" variant="secondary" {...props} />
        </Box>
        <Box padding={1}>
          <Button onClick={handleDemoClick} text="Outline" variant="outline" {...props} />
        </Box>
        <Box padding={1}>
          <Button onClick={handleDemoClick} text="Destructive" variant="destructive" {...props} />
        </Box>
        <Box padding={1}>
          <Button onClick={handleDemoClick} text="Muted" variant="muted" {...props} />
        </Box>
        <Box padding={1}>
          <Button onClick={handleDemoClick} text="Ghost" variant="ghost" {...props} />
        </Box>
        <Box padding={1}>
          <Button disabled onClick={handleDemoClick} text="Disabled" {...props} />
        </Box>
      </Box>
      <Box direction="column" paddingX={1} paddingY={4}>
        <Heading>Disabled Variants</Heading>
      </Box>
      <Box direction="row" wrap>
        <Box padding={1}>
          <Button disabled onClick={handleDemoClick} text="Default/Primary" {...props} />
        </Box>
        <Box padding={1}>
          <Button
            disabled
            onClick={handleDemoClick}
            text="Secondary"
            variant="secondary"
            {...props}
          />
        </Box>
        <Box padding={1}>
          <Button disabled onClick={handleDemoClick} text="Outline" variant="outline" {...props} />
        </Box>
        <Box padding={1}>
          <Button
            disabled
            onClick={handleDemoClick}
            text="Destructive"
            variant="destructive"
            {...props}
          />
        </Box>
        <Box padding={1}>
          <Button disabled onClick={handleDemoClick} text="Muted" variant="muted" {...props} />
        </Box>
        <Box padding={1}>
          <Button disabled onClick={handleDemoClick} text="Ghost" variant="ghost" {...props} />
        </Box>
      </Box>
    </>
  );
};

export const ButtonStates: React.FC<Partial<ButtonProps>> = (props = {}) => {
  return (
    <Box direction="column" gap={4}>
      {BUTTON_STATE_VARIANTS.map(({label, variant}) => (
        <Box alignItems="center" direction="row" gap={4} key={variant}>
          <Box width={100}>
            <Text>{label}</Text>
          </Box>
          <Box alignItems="center" gap={1}>
            <Text>Default</Text>
            <Button
              onClick={handleDemoClick}
              state="default"
              text={`${label} default`}
              variant={variant}
              {...props}
            />
          </Box>
          <Box alignItems="center" gap={1}>
            <Text>Active</Text>
            <Button
              onClick={handleDemoClick}
              state="active"
              text={`${label} active`}
              variant={variant}
              {...props}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export const ButtonIconPosition: React.FC = () => {
  return (
    <Box direction="row" wrap>
      <Box padding={1}>
        <Button iconName="check" onClick={handleDemoClick} text="Icon default" />
      </Box>
      <Box padding={1}>
        <Button iconName="check" iconPosition="right" onClick={handleDemoClick} text="Icon Right" />
      </Box>
    </Box>
  );
};

export const ButtonLoading: React.FC = () => {
  return (
    <Box direction="row" wrap>
      <Box padding={1}>
        <Button
          onClick={async (): Promise<void> => {
            return new Promise((resolve) => {
              setTimeout(resolve, 2 * 1000);
            });
          }}
          text="Async Loading Button"
        />
      </Box>
      <Box padding={1}>
        <Button loading onClick={handleDemoClick} text="Is Loading" />
      </Box>
    </Box>
  );
};

export const ConfirmationButton: React.FC = () => {
  return (
    <Box>
      <Box paddingX={3} paddingY={3}>
        <Button onClick={handleDemoClick} text="Default Confirmation Modal" withConfirmation />
      </Box>
      <Box paddingX={3} paddingY={1}>
        <Button
          confirmationText="And some custom text body!"
          modalTitle="A Custom Title"
          onClick={handleDemoClick}
          text="With Custom Modal Props"
          withConfirmation
        />
      </Box>
    </Box>
  );
};

export const FullWidthButtons: React.FC<Partial<ButtonProps>> = (props = {}) => {
  return (
    <Box gap={4}>
      <Box gap={2}>
        <Heading>Column Layout - default width</Heading>
        <Box color="secondaryLight" direction="column" gap={2} padding={2}>
          <Button onClick={handleDemoClick} text="Button 1" {...props} />
          <Button onClick={handleDemoClick} text="Longer Button 2" {...props} />
          <Button onClick={handleDemoClick} text="Button 3" variant="secondary" {...props} />
        </Box>
      </Box>

      <Box gap={2}>
        <Heading>Column Layout - fullWidth</Heading>
        <Box color="secondaryLight" direction="column" gap={2} padding={2}>
          <Button fullWidth onClick={handleDemoClick} text="Button 1" {...props} />
          <Button fullWidth onClick={handleDemoClick} text="Longer Button 2" {...props} />
          <Button
            fullWidth
            onClick={handleDemoClick}
            text="Button 3"
            variant="secondary"
            {...props}
          />
        </Box>
      </Box>

      <Box gap={2}>
        <Heading>Row Layout - default width</Heading>
        <Box color="secondaryLight" direction="row" gap={2} padding={2}>
          <Button onClick={handleDemoClick} text="Button 1" {...props} />
          <Button onClick={handleDemoClick} text="Longer Button 2" {...props} />
          <Button onClick={handleDemoClick} text="Button 3" variant="secondary" {...props} />
        </Box>
      </Box>

      <Box gap={2}>
        <Heading>Row Layout - fullWidth</Heading>
        <Box color="secondaryLight" direction="row" gap={2} padding={2}>
          <Button fullWidth onClick={handleDemoClick} text="Button 1" {...props} />
        </Box>
      </Box>
    </Box>
  );
};

export const ButtonPressAnimations: React.FC = () => (
  <Box gap={4}>
    <Box gap={1}>
      <Heading>Pressto press animations</Heading>
      <Text>Press each row to compare Pressto animations across every button variant.</Text>
    </Box>
    {BUTTON_PRESS_ANIMATIONS.map((animation) => (
      <Box border="default" gap={2} key={animation.value} padding={3} rounding="md">
        <Box gap={1}>
          <Heading>{animation.label}</Heading>
          <Text>{animation.description}</Text>
        </Box>
        <Box direction="row" wrap>
          {BUTTON_VARIANT_EXAMPLES.map((button) => (
            <Box key={`${animation.value}-${button.text}`} padding={1}>
              <Button
                iconName={button.iconName}
                onClick={handleDemoClick}
                pressAnimation={animation.value}
                text={`${button.text} ${animation.label}`}
                variant={button.variant}
              />
            </Box>
          ))}
          <Box padding={1}>
            <Button
              disabled
              onClick={handleDemoClick}
              pressAnimation={animation.value}
              text={`Disabled ${animation.label}`}
            />
          </Box>
        </Box>
      </Box>
    ))}
  </Box>
);

export const ButtonSizes: React.FC = () => (
  <Box gap={4}>
    <Box gap={1}>
      <Heading>Default size</Heading>
      <Box direction="row" wrap>
        {BUTTON_VARIANT_EXAMPLES.map((button) => (
          <Box key={`default-${button.text}`} padding={1}>
            <Button
              iconName={button.iconName}
              onClick={handleDemoClick}
              text={button.text}
              variant={button.variant}
            />
          </Box>
        ))}
      </Box>
    </Box>
    <Box gap={1}>
      <Heading>Small (sm)</Heading>
      <Box direction="row" wrap>
        {BUTTON_VARIANT_EXAMPLES.map((button) => (
          <Box key={`sm-${button.text}`} padding={1}>
            <Button
              iconName={button.iconName}
              onClick={handleDemoClick}
              size="sm"
              text={button.text}
              variant={button.variant}
            />
          </Box>
        ))}
      </Box>
    </Box>
  </Box>
);

export const MultilineButtons: React.FC = () => (
  <Box direction="row" wrap>
    <Box maxWidth={400} padding={1}>
      <Button onClick={handleDemoClick} text={"Here is some text\nAnd a second line"} />
    </Box>
    <Box maxWidth={400} padding={1}>
      <Button
        iconName="plus"
        onClick={handleDemoClick}
        text={"Here is some text and \nA second line with an icon"}
      />
    </Box>
  </Box>
);
