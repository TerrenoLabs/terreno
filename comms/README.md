# @terreno/comms

Pluggable communications providers for Terreno backends.

## Install

```bash
bun add @terreno/comms
```

Peer dependency: `mongoose ^8.0.0 || ^9.0.0`. `@terreno/api` is required at runtime.

## Quick start

```typescript
import {
  CommsApp,
  ConsoleMailProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  ConsoleVerificationProvider,
} from "@terreno/comms";
import {TerrenoApp} from "@terreno/api";
import {User} from "./models/user";

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      defaultFrom: "notifications@example.com",
      mail: new ConsoleMailProvider(),
      push: new ConsolePushProvider(),
      sms: new ConsoleSmsProvider(),
      verification: new ConsoleVerificationProvider(),
    })
  )
  .start();
```

Send from routes or jobs with `getCommsService()`. Console providers log counts and lengths only — never content, addresses, tokens, or codes.

## What's included

- `CommsApp` — TerrenoPlugin for mail, SMS, push, and verification
- Console providers for local development
- `CommsMessage` / `PushToken` models and admin explorer routes
- Adapter subpath `@terreno/comms/adapters/sendgrid` (optional peer `@sendgrid/mail`)
- Adapter subpath `@terreno/comms/adapters/twilioSms` (optional peer `twilio`)
- Adapter subpath `@terreno/comms/adapters/twilioVerify` (optional peer `twilio`)
- Adapter subpath `@terreno/comms/adapters/expoPush` (optional peer `expo-server-sdk`)
- `beforeSend`, delivery events, opt-out, and payload retention controls

## Documentation

Full API reference: [docs/reference/comms.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/comms.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
