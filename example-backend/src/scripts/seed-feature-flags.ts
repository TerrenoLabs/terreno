/**
 * Seed example feature flags for testing
 *
 * Run with: bun run src/scripts/seed-feature-flags.ts
 *
 * Creates sample boolean and variant flags to demonstrate the feature flags
 * system. Skips any flags that already exist (matched by key).
 */

import {logger, type SeedContext} from "@terreno/api";
import {FeatureFlag} from "@terreno/feature-flags";
import mongoose from "mongoose";
import {Configuration} from "../models/configuration";
import {connectToMongoDB} from "../utils/database";

const SEED_FLAGS = [
  {
    defaultVariant: "on",
    description: "Show a summary card with todo counts above the todo list",
    enabled: true,
    key: "todo-summary-card",
    name: "Todo Summary Card",
    rolloutPercentage: 100,
    rules: [],
    type: "boolean" as const,
  },
  {
    defaultVariant: "off",
    description: "Allow users to set priority (low/medium/high) on todos",
    enabled: true,
    key: "todo-priority",
    name: "Todo Priority Field",
    rolloutPercentage: 50,
    rules: [
      {
        enabled: true,
        segment: "admin-users",
      },
    ],
    type: "boolean" as const,
  },
  {
    defaultVariant: "on",
    description: "Show dark mode toggle in profile settings",
    enabled: true,
    key: "dark-mode-toggle",
    name: "Dark Mode Toggle",
    rolloutPercentage: 100,
    rules: [],
    type: "boolean" as const,
  },
  {
    defaultVariant: "compact",
    description: "A/B test for the profile page layout",
    enabled: true,
    key: "profile-layout",
    name: "Profile Layout Experiment",
    rules: [],
    type: "variant" as const,
    variants: [
      {key: "compact", weight: 50},
      {key: "detailed", weight: 50},
    ],
  },
  {
    defaultVariant: "on",
    description: "Allow users to upload files to chat and document storage",
    enabled: true,
    key: "file-uploads",
    name: "File Uploads",
    rolloutPercentage: 100,
    rules: [],
    type: "boolean" as const,
  },
  {
    defaultVariant: "off",
    description: "Show the AI features tab in the main navigation",
    enabled: false,
    key: "ai-features",
    name: "AI Features",
    rolloutPercentage: 100,
    rules: [
      {
        enabled: true,
        segment: "admin-users",
      },
    ],
    type: "boolean" as const,
  },
];

export const seedFeatureFlags = async (
  seedContext?: SeedContext
): Promise<{results: string[]; success: boolean}> => {
  let created = 0;
  let skipped = 0;
  const results: string[] = [];

  // Mongoose 9 requires updatePipeline for aggregation pipeline updates.
  const backfill = seedContext?.dryRun
    ? {modifiedCount: 0}
    : await FeatureFlag.updateMany(
        {
          $or: [{defaultVariant: {$exists: false}}, {defaultVariant: null}, {defaultVariant: ""}],
        },
        [
          {
            $set: {
              defaultVariant: {
                $cond: {
                  else: {$ifNull: [{$arrayElemAt: ["$variants.key", 0]}, "off"]},
                  if: {$eq: ["$type", "boolean"]},
                  // MongoDB `$cond` requires `then`; Biome treats bare `then` as Promise-like — suppress.
                  // biome-ignore lint/suspicious/noThenProperty: MongoDB aggregation $cond shape
                  then: "off",
                },
              },
            },
          },
        ],
        {updatePipeline: true}
      );
  if (backfill.modifiedCount > 0) {
    results.push(`Backfilled defaultVariant on ${String(backfill.modifiedCount)} existing flag(s)`);
  }

  for (const flag of SEED_FLAGS) {
    if (seedContext) {
      const result = await seedContext.upsert(FeatureFlag, {key: flag.key}, flag);
      results.push(`${result.change}: ${flag.key}`);
      if (result.change === "created") {
        created++;
      } else {
        skipped++;
      }
      continue;
    }
    const existing = await FeatureFlag.findOneOrNone({key: flag.key});
    if (existing) {
      results.push(`Skipped (already exists): ${flag.key}`);
      skipped++;
      continue;
    }

    await FeatureFlag.create(flag);
    results.push(`Created: ${flag.key} (${flag.type}, enabled: ${flag.enabled})`);
    created++;
  }

  results.push(`Done. Created: ${created}, Skipped: ${skipped}`);
  return {results, success: true};
};

const main = async (): Promise<void> => {
  try {
    logger.info("Connecting to MongoDB...");
    await connectToMongoDB();

    const {results} = await seedFeatureFlags();
    for (const line of results) {
      logger.info(line);
    }

    await Configuration.shutdown();
    await mongoose.disconnect();
  } catch (error: unknown) {
    logger.error(`Error seeding feature flags: ${error}`);
    process.exit(1);
  }
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error(`Unhandled error: ${error}`);
    process.exit(1);
  });
}
