App-defined `Organization.settings` shape.

Augment in the consumer app:

```ts
declare module "@terreno/api" {
  interface OrganizationSettings {
    timezone?: string;
  }
}
```

Or pass a generic to `organizationSettingsOf<MySettings>(organization)`.
