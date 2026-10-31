import {Box, OtpField, Text} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

export const OtpFieldDemo: React.FC = (): ReactElement => {
  const [code, setCode] = useState("");
  const [completed, setCompleted] = useState<string | undefined>(undefined);

  const handleChange = useCallback((next: string): void => {
    setCode(next);
    setCompleted(undefined);
  }, []);

  return (
    <Box gap={2}>
      <OtpField
        helperText="Type or paste a 6-digit code."
        onChange={handleChange}
        onComplete={setCompleted}
        testID="otp-field-demo"
        title="Verification code"
        value={code}
      />
      <Text testID="otp-field-demo-result">
        {completed ? `Completed: ${completed}` : "Waiting for all 6 digits"}
      </Text>
    </Box>
  );
};

export const OtpFieldFourDigits: React.FC = (): ReactElement => {
  return <OtpField length={4} testID="otp-field-four" title="PIN" />;
};

export const OtpFieldError: React.FC = (): ReactElement => {
  const [code, setCode] = useState("123456");
  return (
    <OtpField
      errorText="That code didn't work. Try again."
      onChange={setCode}
      testID="otp-field-error"
      title="Verification code"
      value={code}
    />
  );
};

export const OtpFieldDisabled: React.FC = (): ReactElement => {
  return <OtpField disabled testID="otp-field-disabled" title="Verification code" value="12" />;
};
