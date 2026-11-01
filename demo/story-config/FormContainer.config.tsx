import type {DemoConfiguration} from "@config";
import {FormContainer} from "@terreno/ui";
import type {ReactElement} from "react";

import {
  FormContainerChangePassword,
  FormContainerSignIn,
} from "../stories/FormContainer.stories";

const renderFormContainerDemo = (): ReactElement => <FormContainerSignIn />;

export const FormContainerConfiguration: DemoConfiguration = {
  usageExample:
    'import {FormContainer, type FormContainerHandle} from "@terreno/ui";\n\nconst formRef = useRef<FormContainerHandle>(null);\n\n<FormContainer gap={4} onSubmit={signIn} ref={formRef}>\n  <TextField autoComplete="username" ... />\n  <TextField autoComplete="current-password" onEnter={() => formRef.current?.requestSubmit()} ... />\n  <Button onClick={() => formRef.current?.requestSubmit()} text="Log In" />\n</FormContainer>',
  name: "FormContainer",
  component: FormContainer,
  related: ["Text field", "LoginScreen", "SignUpScreen", "PasswordCard"],
  description:
    "Groups a form's fields. On web it renders a real <form> (display: contents, so layout is the inner Box's) so browsers and password managers pair a username with its password, autofill saved credentials, and offer to save new ones; without it Chrome warns \"Password field is not contained in a form\". On native it is a Box. ref.requestSubmit() submits through the form element on web, so password managers see a real submit.",
  a11yNotes: [
    "With accessibilityLabel the web form is a named form landmark.",
    "The form sets noValidate and always prevents the page reload; fields keep their own validation messages.",
    'username adds a hidden autocomplete="username" input for forms without a username field, such as change password.',
  ],
  category: ["Form", "Foundation"],
  status: {
    documentation: "ready",
    figma: "planned",
    ios: "ready",
    android: "ready",
    web: "ready",
  },
  additionalDocumentation: [],
  interfaceName: "FormContainerProps",
  usage: {
    do: [
      "Wrap every password field and its username or email field in one FormContainer.",
      "Call ref.requestSubmit() from the last field's onEnter and from the submit button.",
      "Give earlier fields returnKeyType=\"next\" and an onEnter that focuses the next field.",
    ],
    doNot: [
      "Do not rely on the browser's implicit submission: TextField stops it so Enter goes to onEnter.",
    ],
  },
  props: {},
  demo: renderFormContainerDemo,
  demoOptions: {},
  stories: {
    "Sign in": {
      description:
        "Enter in Email moves to Password; Enter in Password submits once both are filled.",
      render: () => <FormContainerSignIn />,
    },
    "Change password with a hidden username": {render: () => <FormContainerChangePassword />},
  },
};
