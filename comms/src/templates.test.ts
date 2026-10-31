import {describe, it} from "bun:test";
import {
  DEFAULT_SECURITY_MAIL_TEMPLATES,
  renderSecurityMail,
  SECURITY_MAIL_TEMPLATE_IDS,
  type SecurityMailRenderer,
} from "@terreno/api";
import {assert} from "chai";

import {renderAuthMail, renderTemplate} from "./templates";

describe("renderTemplate", () => {
  it("interpolates own data fields across subject, text, and html", (): void => {
    const rendered = renderTemplate({
      data: {name: "Ada"},
      template: {
        html: "<p>Hello {{name}}</p>",
        subject: "Welcome, {{ name }}",
        text: "Hello {{name}}",
      },
    });

    assert.deepEqual(rendered, {
      html: "<p>Hello Ada</p>",
      subject: "Welcome, Ada",
      text: "Hello Ada",
    });
  });

  it("does not resolve inherited or missing values", (): void => {
    const data = Object.create({constructor: "unsafe"}) as Record<string, unknown>;
    data.name = "Ada";

    const rendered = renderTemplate({
      data,
      template: {
        subject: "{{constructor}} {{missing}} {{name}}",
      },
    });

    assert.equal(rendered.subject, "  Ada");
  });

  it("renders empty strings for null and undefined own properties", (): void => {
    const rendered = renderTemplate({
      data: {name: null, title: undefined},
      template: {
        html: "<p>{{name}}</p>",
        subject: "{{title}} {{name}}",
        text: "{{name}}",
      },
    });
    assert.deepEqual(rendered, {
      html: "<p></p>",
      subject: " ",
      text: "",
    });
  });
});

describe("auth mail templates", () => {
  it("renders resetPassword and verifyEmail links from publicAppUrl", (): void => {
    const reset = renderAuthMail({
      publicAppUrl: "https://app.example.com/",
      templateId: "resetPassword",
      token: "abc123",
    });
    const verify = renderAuthMail({
      publicAppUrl: "https://app.example.com/",
      templateId: "verifyEmail",
      token: "def456",
    });

    assert.deepEqual(reset, {
      html: '<p><a href="https://app.example.com/resetPassword?token=abc123">Reset your password</a></p>',
      subject: "Reset your password",
      text: "Reset your password using this link: https://app.example.com/resetPassword?token=abc123",
    });
    assert.deepEqual(verify, {
      html: '<p><a href="https://app.example.com/verifyEmail?token=def456">Verify your email</a></p>',
      subject: "Verify your email",
      text: "Verify your email using this link: https://app.example.com/verifyEmail?token=def456",
    });
  });

  it("uses app-provided template overrides when present", (): void => {
    const rendered = renderAuthMail({
      publicAppUrl: "https://app.example.com",
      templateId: "resetPassword",
      templates: {
        resetPassword: {
          html: "<p>{{resetUrl}}</p>",
          subject: "Reset for {{token}}",
          text: "{{resetUrl}}",
        },
      },
      token: "abc123",
    });
    assert.deepEqual(rendered, {
      html: "<p>https://app.example.com/resetPassword?token=abc123</p>",
      subject: "Reset for abc123",
      text: "https://app.example.com/resetPassword?token=abc123",
    });
  });
});

describe("security notification templates", () => {
  const data = {
    actor: "An administrator",
    appUrl: "https://app.example.com",
    occurredAt: "October 23, 2026 at 14:05 UTC",
    orgClause: " at Acme <Clinic>",
    orgReference: "Acme <Clinic>",
    providerName: "Google",
    secureAccountLine: "If you did not expect this change, contact support right away.",
  };

  for (const templateId of SECURITY_MAIL_TEMPLATE_IDS) {
    it(`renders ${templateId} with subject, text, and html`, (): void => {
      const rendered = renderAuthMail({data, publicAppUrl: "https://app.example.com", templateId});

      assert.equal(rendered.subject, DEFAULT_SECURITY_MAIL_TEMPLATES[templateId].subject);
      assert.include(rendered.text, "October 23, 2026 at 14:05 UTC");
      assert.include(rendered.text, "contact support right away");
      assert.notInclude(rendered.text, "{{");
      assert.notInclude(rendered.text, "token=");
      assert.include(rendered.html, "<p>");
      assert.notInclude(rendered.html, "{{");
    });
  }

  it("fits AccountSecurityApp notifications.render", (): void => {
    const render: SecurityMailRenderer = renderAuthMail;
    const rendered = render({
      data,
      publicAppUrl: "https://app.example.com",
      templateId: "securitySignInLinkIssued",
    });
    assert.equal(rendered.subject, "A sign-in link was created for your account");
  });

  it("matches the @terreno/api fallback renderer for the same input", (): void => {
    for (const templateId of SECURITY_MAIL_TEMPLATE_IDS) {
      assert.deepEqual(
        renderAuthMail({data, publicAppUrl: "https://app.example.com", templateId}),
        renderSecurityMail({data, templateId})
      );
    }
  });

  it("escapes data in the html body only", (): void => {
    const rendered = renderAuthMail({
      data,
      publicAppUrl: "https://app.example.com",
      templateId: "securityPasskeyRemoved",
    });

    assert.include(rendered.text, "An administrator at Acme <Clinic> removed a passkey");
    assert.include(rendered.html, "An administrator at Acme &lt;Clinic&gt; removed a passkey");
  });

  it("applies app overrides for security template ids", (): void => {
    const rendered = renderAuthMail({
      data,
      publicAppUrl: "https://app.example.com",
      templateId: "securityTwoFactorDisabled",
      templates: {securityTwoFactorDisabled: {subject: "2FA off ({{actor}})", text: "{{appUrl}}"}},
    });

    assert.deepEqual(rendered, {
      subject: "2FA off (An administrator)",
      text: "https://app.example.com",
    });
  });
});

describe("html escaping in auth mail", () => {
  it("escapes & in the html href and keeps it raw in the text", (): void => {
    const rendered = renderAuthMail({
      publicAppUrl: "https://app.example.com/?tenant=a&lang=en",
      templateId: "resetPassword",
      token: "abc123",
    });

    assert.include(
      rendered.html,
      'href="https://app.example.com/?tenant=a&amp;lang=en/resetPassword'
    );
    assert.notInclude(rendered.html, "tenant=a&lang");
    assert.include(rendered.text, "https://app.example.com/?tenant=a&lang=en/resetPassword");
  });
});
