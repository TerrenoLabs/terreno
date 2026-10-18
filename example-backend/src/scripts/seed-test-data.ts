/**
 * Seed test data for E2E testing
 *
 * Run with: bun run src/scripts/seed-test-data.ts
 */

import {LocalDatasetStore, LocalEvaluatorStore, LocalPromptStore} from "@terreno/ai";
import {
  APIError,
  ConsentForm,
  type ConsentFormType,
  ConsentResponse,
  findSyncEntryByModelName,
  logger,
  Membership,
  Notification,
  Organization,
  Permissions,
  registerOrganizationSettings,
  registerSync,
  runSeedCli,
  runSeeds,
  type SeedContext,
  type SeedRunResult,
  type SeedStep,
} from "@terreno/api";
import {
  type CommsChannel,
  type CommsErrorClass,
  CommsMessage,
  type CommsMessageStatus,
} from "@terreno/comms";
import {FeatureFlag} from "@terreno/feature-flags";
import {DateTime} from "luxon";
import mongoose from "mongoose";
// Importing the routers registers the sync configs, so seeded todos/projects get a
// real _syncSeq stamped instead of arriving to clients as legacy seq-0 documents.
import "../api/projects";
import "../api/todos";
import {Configuration} from "../models/configuration";
import {FakeClinicalNote} from "../models/fakeClinicalNote";
import {FakePatientChart} from "../models/fakePatientChart";
import {organizationSettingsSchema} from "../models/organizationSettings";
import {Project} from "../models/project";
import {Todo} from "../models/todo";
import {User} from "../models/user";
import {CLINICIAN_ROLE, DEFAULT_USER_ROLE, SUPERADMIN_ROLE} from "../rbacRoles";
import type {UserDocument} from "../types/models/userTypes";
import {getAuthProvider} from "../utils/betterAuthConfig";
import {seedBetterAuthUserInProcess} from "../utils/betterAuthUserSeed";
import {connectToMongoDB} from "../utils/database";
import {CHAT_SAFETY_DATASET_NAME, seedChatSafetyDataset} from "./chatSafetyDataset";
import {seedAnnouncements} from "./seed-announcements";
import {seedFeatureFlags} from "./seed-feature-flags";
import {seedFakeEhr} from "./seedFakeEhr";

const ensureNotificationSyncRegistered = (): void => {
  if (findSyncEntryByModelName("Notification")) {
    return;
  }
  registerSync({
    config: {scope: {type: "owner"}},
    model: Notification,
    options: {
      permissions: {
        create: [],
        delete: [Permissions.IsOwner],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsOwner],
        update: [Permissions.IsOwner],
      },
      sync: {scope: {type: "owner"}},
    },
    routePath: "/notifications",
  });
};

interface SeedUser {
  admin?: boolean;
  email: string;
  name: string;
  password: string;
  roles?: string[];
}

interface SeedConsentForm {
  active: boolean;
  agreeButtonText?: string;
  allowDecline?: boolean;
  captureSignature?: boolean;
  content: Map<string, string>;
  order: number;
  required: boolean;
  requireScrollToBottom?: boolean;
  slug: string;
  title: string;
  type: ConsentFormType;
  version: number;
}

interface SeedCommsMessage {
  channel: CommsChannel;
  error?: string;
  errorClass?: CommsErrorClass;
  errorCode?: string;
  key: string;
  payload: Record<string, unknown>;
  provider: string;
  status: CommsMessageStatus;
  subject?: string;
  to: string;
}

// Shared organization so both seeded users demonstrate tenant-scoped project sync.
export const EXAMPLE_SUMMARIZE_PROMPT = {
  config: {temperature: 0.3},
  folder: "examples",
  inputSchema: {
    properties: {text: {type: "string"}},
    required: ["text"],
    type: "object",
  },
  name: "example-summarize",
  outputSchema: {type: "string"},
  system: "Write one faithful, concise sentence that preserves the source meaning.",
  tags: ["example", "summarization"],
  template: "Summarize the following text:\n\n{{text}}",
  type: "chat" as const,
  variables: [{key: "text", label: "Source text", required: true}],
};
const EXAMPLE_SUMMARIZE_V2 = {
  ...EXAMPLE_SUMMARIZE_PROMPT,
  system: "Write one faithful sentence of at most 20 words that preserves the source meaning.",
};
const EXAMPLE_DATASET_NAME = "example-gold";
const EXAMPLE_EXPERIMENT_EVALUATOR_TEMPLATE = "schema-assert";
const EXAMPLE_REVIEW_EVALUATOR_TEMPLATE = "correctness-human";

interface SeedNotification {
  archived?: boolean;
  body: string;
  minutesAgo: number;
  read?: boolean;
  title: string;
}

const TEST_USERS: SeedUser[] = [
  {
    email: "test@example.com",
    name: "Test User",
    password: "testpassword123",
  },
  {
    admin: true,
    email: "admin@example.com",
    name: "Admin User",
    password: "testpassword123",
  },
  {
    admin: true,
    email: "superadmin@example.com",
    name: "Super Admin",
    password: "testpassword123",
  },
  {
    email: "clinician@example.com",
    name: "Casey Clinician",
    password: "testpassword123",
    roles: [DEFAULT_USER_ROLE, CLINICIAN_ROLE],
  },
  {
    email: "operator@example.com",
    name: "Platform Operator",
    password: "testpassword123",
    roles: ["operator"],
  },
  {
    email: "orgadmin-alpha@example.com",
    name: "Alpha Org Admin",
    password: "testpassword123",
  },
  {
    email: "orgadmin-beta@example.com",
    name: "Beta Org Admin",
    password: "testpassword123",
  },
];

const SEED_PROJECT_TITLES = ["Example Project", "Sync Rollout"];
const SEED_ORGANIZATIONS = [
  {adminEmail: "orgadmin-alpha@example.com", name: "Alpha Workspace"},
  {adminEmail: "orgadmin-beta@example.com", name: "Beta Workspace"},
];

const SEED_TODOS = ["Try offline mode", "Review the sync status banner"];

const SEED_NOTIFICATIONS: SeedNotification[] = [
  {
    body: "Open the bell to preview the notification drawer.",
    minutesAgo: 5,
    title: "Welcome to notifications",
  },
  {
    body: "Completed items now create an activity notification.",
    minutesAgo: 45,
    read: true,
    title: "Todo activity is connected",
  },
  {
    archived: true,
    body: "Archived notifications remain available on the full history page.",
    minutesAgo: 180,
    read: true,
    title: "Archived example",
  },
];

const SEED_COMMS_MESSAGES: SeedCommsMessage[] = [
  {
    channel: "mail",
    key: "welcome-delivered",
    payload: {subject: "Welcome to Terreno", text: "Your account is ready."},
    provider: "sendgrid",
    status: "delivered",
    subject: "Welcome to Terreno",
    to: "a***@example.com",
  },
  {
    channel: "mail",
    key: "password-reset-sent",
    payload: {subject: "Reset your password", text: "Use the secure reset link."},
    provider: "sendgrid",
    status: "sent",
    subject: "Reset your password",
    to: "b***@example.com",
  },
  {
    channel: "push",
    key: "weekly-digest-delivered",
    payload: {body: "You completed 4 tasks this week.", title: "Weekly digest"},
    provider: "expo",
    status: "delivered",
    subject: "Weekly digest",
    to: "ExpoPushToken[…7C2]",
  },
  {
    channel: "sms",
    key: "appointment-reminder-sent",
    payload: {body: "Reminder: your appointment starts in 30 minutes."},
    provider: "twilio",
    status: "sent",
    to: "***-***-0142",
  },
  {
    channel: "mail",
    error: "Provider request timed out",
    errorClass: "transient",
    errorCode: "ETIMEDOUT",
    key: "invoice-failed",
    payload: {subject: "Your invoice is ready", text: "Invoice #1042 is ready to view."},
    provider: "sendgrid",
    status: "failed",
    subject: "Your invoice is ready",
    to: "c***@example.com",
  },
  {
    channel: "mail",
    error: "Recipient mailbox is unavailable",
    errorClass: "permanent",
    errorCode: "bounce-550",
    key: "invite-bounced",
    payload: {subject: "You have been invited", text: "Join the example workspace."},
    provider: "sendgrid",
    status: "bounced",
    subject: "You have been invited",
    to: "d***@example.com",
  },
  {
    channel: "mail",
    key: "receipt-delivered",
    payload: {subject: "Payment receipt", text: "Thanks for your payment."},
    provider: "sendgrid",
    status: "delivered",
    subject: "Payment receipt",
    to: "e***@example.com",
  },
  {
    channel: "verification",
    error: "Cancelled by beforeSend",
    errorClass: "permanent",
    errorCode: "before-send-cancel",
    key: "verification-cancelled",
    payload: {channel: "sms"},
    provider: "console",
    status: "cancelled",
    to: "***-***-0199",
  },
  {
    channel: "sms",
    key: "security-code-delivered",
    payload: {body: "Your security code was delivered."},
    provider: "console",
    status: "delivered",
    to: "***-***-0175",
  },
  {
    channel: "push",
    key: "project-update-sent",
    payload: {body: "Sync Rollout was updated.", title: "Project update"},
    provider: "expo",
    status: "sent",
    subject: "Project update",
    to: "ExpoPushToken[…9A4]",
  },
];

const CONSENT_FORMS: SeedConsentForm[] = [
  {
    active: true,
    agreeButtonText: "I Accept the Terms",
    captureSignature: true,
    content: new Map([
      [
        "en",
        `# Terms of Service

Welcome to our application. By using our service, you agree to the following terms...

## 1. Acceptance of Terms

By accessing or using our application, you agree to be bound by these Terms of Service.

## 2. Use of Service

You agree to use the service only for lawful purposes and in a way that does not infringe the rights of others.

## 3. Privacy

Your use of the service is also governed by our Privacy Policy.

## 4. Changes to Terms

We reserve the right to modify these terms at any time. We will notify you of any changes.`,
      ],
    ]),
    order: 1,
    required: true,
    requireScrollToBottom: true,
    slug: "terms-of-service",
    title: "Terms of Service",
    type: "terms",
    version: 1,
  },
  {
    active: true,
    content: new Map([
      [
        "en",
        `# Privacy Policy

We are committed to protecting your personal information.

## Information We Collect

We collect information you provide directly to us, such as when you create an account.

## How We Use Your Information

We use the information we collect to provide, maintain, and improve our services.

## Data Security

We implement appropriate technical and organizational measures to protect your personal information.

## Contact Us

If you have any questions about this Privacy Policy, please contact us.`,
      ],
    ]),
    order: 2,
    required: true,
    requireScrollToBottom: true,
    slug: "privacy-policy",
    title: "Privacy Policy",
    type: "privacy",
    version: 1,
  },
  {
    active: true,
    allowDecline: true,
    content: new Map([
      [
        "en",
        `# Data Collection Consent

We would like to collect anonymized usage data to improve our services.

## What We Collect

- App usage patterns (screens visited, features used)
- Device information (OS version, screen size)
- Performance metrics (load times, error rates)

## How It Helps

This data helps us identify bugs, improve performance, and prioritize new features.

## Your Choice

This consent is optional. You can decline without affecting your use of the application. You can change your preference at any time in Settings.`,
      ],
    ]),
    order: 3,
    required: false,
    slug: "data-collection",
    title: "Data Collection Consent",
    type: "research",
    version: 1,
  },
];

const seedRolesForUser = (testUser: SeedUser): string[] => {
  if (testUser.roles) {
    return testUser.roles;
  }
  return testUser.admin ? [SUPERADMIN_ROLE] : [DEFAULT_USER_ROLE];
};

const applySeedRoles = (
  user: UserDocument,
  testUser: SeedUser
): {changed: boolean; user: UserDocument} => {
  const roles = seedRolesForUser(testUser);
  const rbacUser = user as UserDocument & {roles?: string[]};
  const currentRoles = rbacUser.roles ?? [];
  const missingRoles = roles.filter((role) => !currentRoles.includes(role));
  if (missingRoles.length === 0) {
    return {changed: false, user};
  }
  rbacUser.roles = [...new Set([...currentRoles, ...roles])];
  return {changed: true, user};
};

/** Ensure the Mongoose user doc reflects the seed's admin flag and roles. */
const reconcileMongooseUser = async (testUser: SeedUser): Promise<UserDocument> => {
  const user = await User.findByEmail(testUser.email);
  if (!user) {
    throw new APIError({
      status: 500,
      title: `User ${testUser.email} was not synced to Mongoose`,
    });
  }
  let changed = false;
  if (testUser.admin && !user.admin) {
    user.admin = true;
    changed = true;
  }
  const withRoles = applySeedRoles(user, testUser);
  if (withRoles.changed) {
    changed = true;
  }
  if (changed) {
    await user.save();
  }
  return user;
};

const seedUser = async (testUser: SeedUser): Promise<UserDocument> => {
  if (getAuthProvider() === "better-auth") {
    // Idempotent credential provisioning: creates the Better Auth account when missing
    // (sign-up), otherwise verifies it (sign-in), and syncs/links the Mongoose user by
    // email. Runs even when a legacy Mongoose user already exists (e.g. seeded under the
    // old passport/JWT flow) — otherwise that user would have no Better Auth password and
    // every sign-in would 401.
    await seedBetterAuthUserInProcess({
      email: testUser.email,
      name: testUser.name,
      password: testUser.password,
    });
    const user = await reconcileMongooseUser(testUser);
    logger.info(`Better Auth user ready: ${user.email} (id: ${user._id})`);
    return user;
  }

  const existingUser = await User.findByEmail(testUser.email);
  if (existingUser) {
    logger.info(`Test user already exists: ${testUser.email}`);
    await reconcileMongooseUser(testUser);
    return existingUser;
  }

  const user = await User.register(
    {
      admin: testUser.admin ?? false,
      email: testUser.email,
      name: testUser.name,
      roles: seedRolesForUser(testUser),
    },
    testUser.password
  );

  logger.info(`Test user created: ${user.email} (id: ${user._id})`);
  return user as UserDocument;
};

const seedOrganizations = async (context: SeedContext): Promise<void> => {
  registerOrganizationSettings(organizationSettingsSchema);
  const owner = seededUsers.find((user) => user.email === "operator@example.com");
  if (!owner) {
    throw new APIError({status: 500, title: "Seed operator not found"});
  }
  for (const definition of SEED_ORGANIZATIONS) {
    await context.upsert(
      Organization,
      {name: definition.name},
      {name: definition.name, ownerId: owner._id}
    );
    if (context.dryRun) {
      continue;
    }
    const organization = await Organization.findExactlyOne({name: definition.name});
    const orgAdmin = seededUsers.find((user) => user.email === definition.adminEmail);
    if (!orgAdmin) {
      throw new APIError({status: 500, title: `Seed user ${definition.adminEmail} not found`});
    }
    await context.upsert(
      Membership,
      {organizationId: organization._id, userId: orgAdmin._id},
      {organizationId: organization._id, roleName: "org-admin", userId: orgAdmin._id}
    );
    const testUser = seededUsers.find((user) => user.email === "test@example.com");
    if (definition.name === "Alpha Workspace" && testUser) {
      await context.upsert(
        Membership,
        {organizationId: organization._id, userId: testUser._id},
        {organizationId: organization._id, roleName: "member", userId: testUser._id}
      );
    }
  }
};

const seedProjects = async (context: SeedContext): Promise<void> => {
  const organization = await Organization.findOneOrNone({slug: "alpha-workspace"});
  if (!organization) {
    if (context.dryRun) {
      return;
    }
    throw new APIError({status: 500, title: "Seed organization Alpha Workspace not found"});
  }
  for (const title of SEED_PROJECT_TITLES) {
    const project = {organizationId: String(organization._id), title};
    await context.upsert(
      Project,
      {organizationId: project.organizationId, title: project.title},
      project
    );
  }
};

const seedTodos = async (context: SeedContext, owner: UserDocument): Promise<void> => {
  for (const title of SEED_TODOS) {
    await context.upsert(Todo, {ownerId: owner._id, title}, {ownerId: owner._id, title});
  }
};

const seedNotifications = async (context: SeedContext, owner: UserDocument): Promise<void> => {
  ensureNotificationSyncRegistered();
  const seededAt = DateTime.utc();
  for (const notification of SEED_NOTIFICATIONS) {
    const values = {
      archivedAt: notification.archived ? seededAt.toJSDate() : null,
      body: notification.body,
      created: seededAt.minus({minutes: notification.minutesAgo}).toJSDate(),
      href: "/",
      kind: "seed",
      ownerId: owner._id,
      readAt: notification.read ? seededAt.toJSDate() : null,
      title: notification.title,
    };
    await context.upsert(Notification, {ownerId: owner._id, title: notification.title}, values);
    if (context.dryRun) {
      continue;
    }
    const seededNotification = await Notification.findExactlyOne({
      ownerId: owner._id,
      title: notification.title,
    });
    if (seededNotification.get("_syncSeq") == null) {
      seededNotification.markModified("body");
      await seededNotification.save();
    }
  }
};

/** Seed current, representative delivery logs so the comms dashboard is useful after setup. */
const seedCommsMessages = async (context: SeedContext, admin: UserDocument): Promise<void> => {
  const seededAt = DateTime.utc();
  for (const [index, message] of SEED_COMMS_MESSAGES.entries()) {
    const attemptAt = seededAt.minus({minutes: index * 18}).toJSDate();
    const providerMessageId = `demo-${message.key}`;
    await context.upsert(
      CommsMessage,
      {providerMessageId},
      {
        attemptCount: 1,
        attempts: [
          {
            at: attemptAt,
            error: message.error,
            errorClass: message.errorClass,
            errorCode: message.errorCode,
            provider: message.provider,
            providerMessageId,
          },
        ],
        channel: message.channel,
        created: attemptAt,
        error: message.error,
        errorClass: message.errorClass,
        errorCode: message.errorCode,
        lastAttemptAt: attemptAt,
        metadata: {demoSeed: true, seedKey: message.key},
        payload: message.payload,
        payloadExpiresAt: seededAt.plus({days: 30}).toJSDate(),
        provider: message.provider,
        status: message.status,
        subject: message.subject,
        to: message.to,
        userId: admin._id,
      }
    );
  }
  logger.info(`Seeded ${SEED_COMMS_MESSAGES.length} current comms delivery logs`);
};

/** Accept active consent forms so Maestro/Playwright logins land on the app shell. */
const acceptPendingConsentsForUser = async (user: UserDocument): Promise<void> => {
  const activeForms = await ConsentForm.find({active: true}).sort({order: 1});
  const existingResponses = await ConsentResponse.find({userId: user._id});

  const pendingForms = activeForms.filter((form) => {
    const formId = form._id.toString();
    const matchingResponses = existingResponses.filter(
      (response) => response.consentFormId.toString() === formId
    );
    if (matchingResponses.length === 0) {
      return true;
    }
    return !matchingResponses.some((response) => response.formVersionSnapshot === form.version);
  });

  if (pendingForms.length === 0) {
    logger.info(`All consent forms already accepted for ${user.email}`);
    return;
  }

  const agreedAt = DateTime.now().toJSDate();
  for (const form of pendingForms) {
    await ConsentResponse.create({
      agreed: true,
      agreedAt,
      consentFormId: form._id,
      formVersionSnapshot: form.version,
      locale: "en",
      userId: user._id,
      ...(form.captureSignature ? {signature: "E2E Seed", signedAt: agreedAt} : {}),
    });
    logger.info(`Accepted consent ${form.slug} for ${user.email}`);
  }
};

const seedConsentForms = async (context: SeedContext): Promise<void> => {
  for (const form of CONSENT_FORMS) {
    await context.upsert(ConsentForm, {slug: form.slug}, form);
  }
};

const softDeleteAll = async (
  context: SeedContext,
  documents: Array<{deleted: boolean; save: () => Promise<unknown>}>,
  model: string
): Promise<void> => {
  context.changes.push({
    change: documents.length > 0 ? "deleted" : "unchanged",
    count: documents.length,
    key: "{}",
    model,
  });
  if (context.dryRun) {
    return;
  }
  for (const document of documents) {
    document.deleted = true;
    await document.save();
  }
};

const seededUsers: UserDocument[] = [];

const seedObservability = async (context: SeedContext): Promise<void> => {
  const promptStore = new LocalPromptStore();
  const prompt = (await promptStore.list({search: EXAMPLE_SUMMARIZE_PROMPT.name})).find(
    (entry) => entry.name === EXAMPLE_SUMMARIZE_PROMPT.name
  );
  context.changes.push({
    change: prompt ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({name: EXAMPLE_SUMMARIZE_PROMPT.name}),
    model: "ObsPrompt",
  });
  if (!context.dryRun && !prompt) {
    await promptStore.create(EXAMPLE_SUMMARIZE_PROMPT);
    await promptStore.moveLabel(EXAMPLE_SUMMARIZE_PROMPT.name, {
      label: "production",
      version: 1,
    });
  } else if (!context.dryRun && prompt?.production === "—") {
    await promptStore.moveLabel(EXAMPLE_SUMMARIZE_PROMPT.name, {
      label: "production",
      version: prompt.latestVersion,
    });
  }
  const latestPrompt = (await promptStore.list({search: EXAMPLE_SUMMARIZE_PROMPT.name})).find(
    (entry) => entry.name === EXAMPLE_SUMMARIZE_PROMPT.name
  );
  if (!context.dryRun && (latestPrompt?.latestVersion ?? 0) < 2) {
    await promptStore.createVersion(EXAMPLE_SUMMARIZE_PROMPT.name, EXAMPLE_SUMMARIZE_V2);
  }

  const evaluatorStore = new LocalEvaluatorStore();
  for (const templateName of [
    EXAMPLE_REVIEW_EVALUATOR_TEMPLATE,
    EXAMPLE_EXPERIMENT_EVALUATOR_TEMPLATE,
  ]) {
    const evaluator = (await evaluatorStore.list()).find((entry) => entry.name === templateName);
    context.changes.push({
      change: evaluator ? "unchanged" : "created",
      count: 1,
      key: JSON.stringify({name: templateName}),
      model: "ObsEvaluator",
    });
    if (!context.dryRun && !evaluator) {
      await evaluatorStore.installTemplate(templateName);
    }
  }

  const datasetStore = new LocalDatasetStore(promptStore);
  const existingDataset = (await datasetStore.list()).find(
    (entry) => entry.name === EXAMPLE_DATASET_NAME
  );
  context.changes.push({
    change: existingDataset ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({name: EXAMPLE_DATASET_NAME}),
    model: "ObsDataset",
  });
  if (!context.dryRun) {
    const dataset =
      existingDataset ??
      (await datasetStore.create({
        inputSchemaPromptName: EXAMPLE_SUMMARIZE_PROMPT.name,
        name: EXAMPLE_DATASET_NAME,
        tags: ["example", "gold"],
      }));
    const items = await datasetStore.listItems(dataset.id);
    if (items.length === 0) {
      await datasetStore.importJson(dataset.id, [
        {
          expectedOutput: "Terreno provides a batteries-included TypeScript framework.",
          input: {text: "Terreno is a batteries-included full-stack framework for TypeScript."},
          proofread: true,
          tags: ["framework"],
        },
        {
          expectedOutput: "One React Native codebase ships to web, iOS, and Android.",
          input: {text: "Terreno's universal app runs on web, iOS, and Android from one codebase."},
          proofread: true,
          tags: ["universal"],
        },
      ]);
    }
  }

  const safety = await seedChatSafetyDataset({dryRun: context.dryRun});
  context.changes.push({
    change: safety.datasetChange,
    count: 1,
    key: JSON.stringify({name: CHAT_SAFETY_DATASET_NAME}),
    model: "ObsDataset",
  });
};

export const seedSteps: SeedStep[] = [
  {
    name: "users",
    run: async (context) => {
      seededUsers.length = 0;
      for (const testUser of TEST_USERS) {
        if (context.dryRun) {
          const existingUser = await User.findByEmail(testUser.email);
          context.changes.push({
            change: existingUser ? "updated" : "created",
            count: 1,
            key: JSON.stringify({email: testUser.email}),
            model: User.modelName,
          });
          seededUsers.push(
            existingUser ??
              ({
                _id: new mongoose.Types.ObjectId(),
                email: testUser.email,
              } as UserDocument)
          );
          continue;
        }
        seededUsers.push(await seedUser(testUser));
      }
    },
  },
  {
    dependsOn: ["users"],
    name: "organizations",
    reset: async (context) => {
      await context.deleteMany(Membership);
      await context.deleteMany(Organization);
    },
    run: seedOrganizations,
  },
  {
    dependsOn: ["organizations"],
    name: "projects",
    reset: async (context) => {
      await softDeleteAll(context, await Project.find({}), Project.modelName);
    },
    run: seedProjects,
  },
  {
    dependsOn: ["users"],
    name: "todos",
    reset: async (context) => {
      await softDeleteAll(context, await Todo.find({}), Todo.modelName);
    },
    run: async (context) => {
      if (seededUsers[0]) {
        await seedTodos(context, seededUsers[0]);
      }
    },
  },
  {
    dependsOn: ["users"],
    name: "notifications",
    reset: async (context) => {
      const seededNotifications = await Notification.find({
        deleted: {$in: [false, true]},
        kind: "seed",
      });
      await softDeleteAll(context, seededNotifications, Notification.modelName);
    },
    run: async (context) => {
      if (seededUsers[0]) {
        await seedNotifications(context, seededUsers[0]);
      }
    },
  },
  {
    name: "consentForms",
    reset: async (context) => {
      await context.deleteMany(ConsentForm);
    },
    run: seedConsentForms,
  },
  {
    dependsOn: ["users", "consentForms"],
    name: "consentResponses",
    reset: async (context) => {
      await context.deleteMany(ConsentResponse);
    },
    run: async (context) => {
      if (context.dryRun) {
        return;
      }
      for (const user of seededUsers) {
        await acceptPendingConsentsForUser(user);
      }
    },
  },
  {
    name: "featureFlags",
    reset: async (context) => {
      await context.deleteMany(FeatureFlag);
    },
    run: async (context) => {
      await seedFeatureFlags(context);
    },
  },
  {
    name: "announcements",
    reset: async (context) => {
      const {Announcement} = await import("@terreno/announcements");
      await context.deleteMany(Announcement);
    },
    run: async (context) => {
      await seedAnnouncements(context);
    },
  },
  {
    dependsOn: ["users"],
    name: "commsMessages",
    reset: async (context) => {
      // Intentionally does not touch terreno_migrations; seed reset is not a schema rollback.
      await context.deleteMany(CommsMessage, {"metadata.demoSeed": true});
    },
    run: async (context) => {
      const adminUser = seededUsers.find((user) => user.email === "admin@example.com");
      if (adminUser) {
        await seedCommsMessages(context, adminUser);
      }
    },
  },
  {
    name: "aiObservability",
    run: seedObservability,
  },
  {
    description: "Synthetic patient charts for the clinic.intakeSummary harness tracer",
    name: "fakeEhr",
    reset: async (context) => {
      await context.deleteMany(FakePatientChart);
      await context.deleteMany(FakeClinicalNote);
    },
    run: seedFakeEhr,
  },
];

/** Seed the idempotent example users and records into the active MongoDB database. */
export const seedDefaultData = async (): Promise<SeedRunResult> => {
  return runSeeds({name: "example-backend", steps: seedSteps});
};

const main = async (): Promise<void> => {
  const cli = await runSeedCli({
    allowProductionReset: () => process.env.ALLOW_SEED_RESET === "true",
    connect: connectToMongoDB,
    disconnect: async () => {
      await Configuration.shutdown();
      await mongoose.disconnect();
    },
    name: "bun run seed",
    steps: seedSteps,
  });
  if (cli.help) {
    logger.info(cli.help);
  }
  process.exit(cli.exitCode);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error(`Unhandled error: ${error}`);
    process.exit(1);
  });
}
