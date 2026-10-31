import type {FormContainerHandle} from "@terreno/ui";
import {Button, FormContainer, Text, TextField} from "@terreno/ui";
import {type ReactElement, useCallback, useRef, useState} from "react";
import type {TextInput} from "react-native";

/**
 * A sign-in form: Enter in Email moves to Password, Enter in Password submits through the form,
 * and the result line counts submissions.
 */
export const FormContainerSignIn: React.FC = (): ReactElement => {
  const formRef = useRef<FormContainerHandle>(null);
  const passwordRef = useRef<TextInput | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitCount, setSubmitCount] = useState(0);
  const canSubmit = Boolean(email.trim() && password);

  const handleSubmit = useCallback((): void => {
    if (!canSubmit) {
      return;
    }
    setSubmitCount((count) => count + 1);
  }, [canSubmit]);

  const requestSubmit = useCallback(async (): Promise<void> => {
    await formRef.current?.requestSubmit();
  }, []);

  return (
    <FormContainer
      accessibilityLabel="Sign in"
      gap={4}
      maxWidth={400}
      onSubmit={handleSubmit}
      ref={formRef}
      testID="form-container-demo"
      width="100%"
    >
      <TextField
        accessibilityLabel="Email"
        autoComplete="username"
        blurOnSubmit={false}
        onChange={setEmail}
        onEnter={() => passwordRef.current?.focus()}
        returnKeyType="next"
        testID="form-container-demo-email"
        title="Email"
        type="email"
        value={email}
      />
      <TextField
        accessibilityLabel="Password"
        autoComplete="current-password"
        inputRef={(ref) => {
          passwordRef.current = ref;
        }}
        onChange={setPassword}
        onEnter={requestSubmit}
        returnKeyType="go"
        testID="form-container-demo-password"
        title="Password"
        type="password"
        value={password}
      />
      <Button
        disabled={!canSubmit}
        onClick={requestSubmit}
        testID="form-container-demo-submit"
        text="Log In"
      />
      <Text testID="form-container-demo-result">{`Submitted ${submitCount} times`}</Text>
    </FormContainer>
  );
};

/** A change-password form with no username field: the hidden username names the account. */
export const FormContainerChangePassword: React.FC = (): ReactElement => {
  const [password, setPassword] = useState("");
  return (
    <FormContainer
      accessibilityLabel="Change password"
      gap={4}
      maxWidth={400}
      testID="form-container-change-password"
      username="ada@example.com"
      width="100%"
    >
      <TextField
        accessibilityLabel="New password"
        autoComplete="new-password"
        onChange={setPassword}
        title="New password"
        type="password"
        value={password}
      />
    </FormContainer>
  );
};
