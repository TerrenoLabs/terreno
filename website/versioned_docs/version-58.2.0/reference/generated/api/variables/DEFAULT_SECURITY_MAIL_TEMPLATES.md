> `const` **DEFAULT\_SECURITY\_MAIL\_TEMPLATES**: `Record`\<[`SecurityMailTemplateId`](../type-aliases/SecurityMailTemplateId.md), [`SecurityMailTemplate`](../interfaces/SecurityMailTemplate.md)\>

The default notification templates. `@terreno/comms` `DEFAULT_AUTH_MAIL_TEMPLATES` includes
them, so `renderAuthMail` renders them too. Data: `actor` ("You" / "An administrator"),
`orgClause` ("" or " at {org}"), `orgReference` ("{org}" or "an organization"),
`providerName`, `occurredAt`, `appUrl`, and `secureAccountLine`.
