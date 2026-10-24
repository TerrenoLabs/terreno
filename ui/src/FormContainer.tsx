import type {FC, Ref} from "react";
import {createContext, useCallback, useContext, useImperativeHandle, useRef} from "react";
import {Platform} from "react-native";

import {Box} from "./Box";
import type {BoxPropsBase} from "./Common";

/**
 * Imperative handle for {@link FormContainer}, passed through its `ref` prop.
 */
export interface FormContainerHandle {
  /**
   * Submits the form. On web it calls the form element's `requestSubmit()`, so the browser fires a
   * real submit event (password managers watch for it to offer "Save password") and the form's
   * submit handler calls `onSubmit`. On native, and in browsers without `requestSubmit`, it calls
   * `onSubmit` directly. Resolves when `onSubmit` settles, so a button awaiting it shows its
   * loading state.
   */
  requestSubmit: () => Promise<void>;
}

/**
 * Props for {@link FormContainer}. Layout props are the same as {@link Box}'s.
 */
export interface FormContainerProps
  extends Omit<BoxPropsBase, "onClick" | "onHoverStart" | "onHoverEnd" | "scroll"> {
  /**
   * Called when the form is submitted: from `ref.requestSubmit()`, or on web when the browser
   * submits the form. The browser's page reload is always prevented.
   */
  onSubmit?: () => void | Promise<void>;
  /** Names the form for screen readers (on web the form then becomes a "form" landmark). */
  accessibilityLabel?: string;
  /**
   * The signed-in user's username or email, for forms without a username field such as a change
   * password form. On web it goes in a hidden `autocomplete="username"` input, so password managers
   * update that account's saved password. Ignored on native.
   */
  username?: string;
  /** Receives {@link FormContainerHandle}, to submit the form from a field's Enter key or a button. */
  ref?: Ref<FormContainerHandle>;
}

/** True inside a FormContainer's <form>; HTML does not allow a form inside another form. */
const InsideFormContext = createContext(false);

/** The DOM form element's submit method; absent in Safari before 16. */
interface WebFormElement {
  requestSubmit?: () => void;
}

/**
 * Groups a form's fields. On web it renders a real `<form>` around them, so browsers and password
 * managers can pair a username with its password, autofill saved credentials, and offer to save
 * new ones (Chrome warns "Password field is not contained in a form" without it). The form uses
 * `display: contents`, so the children lay out exactly as in the inner {@link Box}, which takes all
 * of Box's layout props. On native it renders just the Box.
 *
 * The form sets `noValidate` and always prevents the browser's page reload. Fields keep their own
 * Enter handling: `TextField` calls `onEnter` and stops the browser's implicit submission, so call
 * `ref.requestSubmit()` from the last field's `onEnter` and from the submit button. A FormContainer
 * inside another one renders a Box (HTML forms cannot nest); its `requestSubmit` calls its own
 * `onSubmit`.
 *
 * @example
 * ```tsx
 * const formRef = useRef<FormContainerHandle>(null);
 *
 * <FormContainer gap={4} onSubmit={signIn} ref={formRef}>
 *   <TextField autoComplete="username" onChange={setEmail} title="Email" type="email" value={email} />
 *   <TextField
 *     autoComplete="current-password"
 *     onChange={setPassword}
 *     onEnter={() => formRef.current?.requestSubmit()}
 *     title="Password"
 *     type="password"
 *     value={password}
 *   />
 *   <Button onClick={() => formRef.current?.requestSubmit()} text="Log In" />
 * </FormContainer>
 * ```
 */
export const FormContainer: FC<FormContainerProps> = ({
  onSubmit,
  accessibilityLabel,
  username,
  ref,
  testID,
  children,
  ...boxProps
}) => {
  const isInsideForm = useContext(InsideFormContext);
  const formElementRef = useRef<WebFormElement | null>(null);
  // A ref keeps requestSubmit stable while still calling the latest onSubmit.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // The browser runs the submit handler inside requestSubmit(); this carries its result back out.
  const pendingSubmitRef = useRef<Promise<void> | undefined>(undefined);

  const handleFormSubmit = useCallback((event: {preventDefault: () => void}): void => {
    event.preventDefault();
    const result = Promise.resolve(onSubmitRef.current?.());
    pendingSubmitRef.current = result;
    // A submit the browser starts on its own has no caller to report a rejection to.
    result.catch((error: unknown) => {
      console.warn("FormContainer: onSubmit rejected", error);
    });
  }, []);

  useImperativeHandle(
    ref,
    (): FormContainerHandle => ({
      requestSubmit: async (): Promise<void> => {
        const form = formElementRef.current;
        if (Platform.OS === "web" && typeof form?.requestSubmit === "function") {
          pendingSubmitRef.current = undefined;
          form.requestSubmit();
          await pendingSubmitRef.current;
          return;
        }
        await onSubmitRef.current?.();
      },
    }),
    []
  );

  if (Platform.OS !== "web") {
    return (
      <Box {...boxProps} testID={testID}>
        {children}
      </Box>
    );
  }

  const usernameInput = Boolean(username) && (
    <input
      aria-hidden
      autoComplete="username"
      data-testid={testID ? `${testID}-username` : undefined}
      hidden
      name="username"
      readOnly
      tabIndex={-1}
      type="text"
      value={username}
    />
  );

  // Nested in another FormContainer, the outer <form> already groups these fields.
  if (isInsideForm) {
    return (
      <Box {...boxProps} testID={testID}>
        {usernameInput}
        {children}
      </Box>
    );
  }

  return (
    <form
      aria-label={accessibilityLabel}
      data-testid={testID}
      noValidate
      onSubmit={handleFormSubmit}
      ref={(element: WebFormElement | null): void => {
        formElementRef.current = element;
      }}
      style={{display: "contents"}}
    >
      {usernameInput}
      <InsideFormContext.Provider value>
        <Box {...boxProps}>{children}</Box>
      </InsideFormContext.Provider>
    </form>
  );
};
