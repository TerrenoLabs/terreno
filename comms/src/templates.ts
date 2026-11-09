import {
  DEFAULT_SECURITY_MAIL_TEMPLATES,
  escapeMailHtml,
  type SecurityMailTemplateId,
} from "@terreno/api";

export interface MessageTemplate {
  html?: string;
  subject: string;
  text?: string;
}

export interface RenderTemplateOptions {
  data: Record<string, unknown>;
  template: MessageTemplate;
}

/**
 * Auth mail templates: the reset/verify links, plus the security notifications
 * `AccountSecurityApp` sends (`securityPasswordChanged`, `securityPasskeyAdded`, ...).
 */
export type AuthMailTemplateId = "resetPassword" | "verifyEmail" | SecurityMailTemplateId;

export interface RenderAuthMailOptions {
  /**
   * Extra placeholder values. Security notifications pass `actor`, `orgClause`, `orgReference`,
   * `providerName`, `occurredAt`, `appUrl`, and `secureAccountLine`.
   */
  data?: Record<string, string>;
  publicAppUrl: string;
  templateId: AuthMailTemplateId;
  /** The reset/verify token. Security notifications carry none. */
  token?: string;
  templates?: Partial<Record<AuthMailTemplateId, MessageTemplate>>;
}

export const DEFAULT_AUTH_MAIL_TEMPLATES: Record<AuthMailTemplateId, MessageTemplate> = {
  ...DEFAULT_SECURITY_MAIL_TEMPLATES,
  resetPassword: {
    html: '<p><a href="{{resetUrl}}">Reset your password</a></p>',
    subject: "Reset your password",
    text: "Reset your password using this link: {{resetUrl}}",
  },
  verifyEmail: {
    html: '<p><a href="{{verifyUrl}}">Verify your email</a></p>',
    subject: "Verify your email",
    text: "Verify your email using this link: {{verifyUrl}}",
  },
};

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z0-9_]+)\s*}}/g;

const interpolate = (value: string, data: Record<string, unknown>): string =>
  value.replace(TEMPLATE_VARIABLE_PATTERN, (_match: string, key: string): string => {
    if (Object.getOwnPropertyDescriptor(data, key) === undefined) {
      return "";
    }

    const replacement = data[key];
    if (replacement === null || replacement === undefined) {
      return "";
    }
    return String(replacement);
  });

export const renderTemplate = ({data, template}: RenderTemplateOptions): MessageTemplate => ({
  ...(template.html === undefined ? {} : {html: interpolate(template.html, data)}),
  subject: interpolate(template.subject, data),
  ...(template.text === undefined ? {} : {text: interpolate(template.text, data)}),
});

const authMailUrl = (publicAppUrl: string, path: string, token: string): string => {
  const base = publicAppUrl.replace(/\/$/, "");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
};

/**
 * Renders an auth mail template. HTML bodies get HTML-escaped values, so data such as an org
 * name cannot inject markup; subject and text get the raw values.
 */
export const renderAuthMail = ({
  data = {},
  publicAppUrl,
  templateId,
  token = "",
  templates,
}: RenderAuthMailOptions): MessageTemplate => {
  const template = templates?.[templateId] ?? DEFAULT_AUTH_MAIL_TEMPLATES[templateId];
  const values: Record<string, string> = {
    ...data,
    publicAppUrl: publicAppUrl.replace(/\/$/, ""),
    resetUrl: authMailUrl(publicAppUrl, "/resetPassword", token),
    token,
    verifyUrl: authMailUrl(publicAppUrl, "/verifyEmail", token),
  };
  const htmlValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, escapeMailHtml(value)])
  );
  const {html, ...plain} = template;
  return {
    ...(html === undefined
      ? {}
      : {html: renderTemplate({data: htmlValues, template: {html, subject: ""}}).html}),
    ...renderTemplate({data: values, template: plain}),
  };
};
