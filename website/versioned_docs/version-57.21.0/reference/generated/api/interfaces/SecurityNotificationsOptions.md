`notifications` on `AccountSecurityApp`.

## Properties

### enabled?

> `optional` **enabled?**: `boolean`

Email the affected user about every security action. Defaults to `true`; nothing is sent
while no `sendMail` is configured.

***

### includeOrgName?

> `optional` **includeOrgName?**: `boolean`

Name the organization in emails about actions an org-admin ran. Defaults to `false`: on a
shared inbox the org name can reveal care.

***

### render?

> `optional` **render?**: [`SecurityMailRenderer`](../type-aliases/SecurityMailRenderer.md)

Renders the emails instead of the built-in renderer, for example `@terreno/comms`
`renderAuthMail`. Not read from `BetterAuthConfig.renderAuthMail`: a renderer written only
for reset and verify mail would answer every security id with one of those. Falls back to
the built-in renderer when it throws or returns no subject.

***

### sendMail?

> `optional` **sendMail?**: (`message`) => `Promise`\<`void`\>

Delivers the emails. Defaults to the registered `BetterAuthApp`'s `sendMail`. Set it with
`setupServer`, where there is no `BetterAuthApp` to read.

#### Parameters

##### message

###### html?

`string`

###### sensitive?

`boolean`

###### subject

`string`

###### text

`string`

###### to

`string`

#### Returns

`Promise`\<`void`\>

***

### throttleMinutes?

> `optional` **throttleMinutes?**: `number`

Send at most one email per user and template in this many minutes, so a burst of the same
change (say, signing out other sessions five times) is one email. Defaults to 10; `0` sends
every one. Every action is still recorded in the audit log.
