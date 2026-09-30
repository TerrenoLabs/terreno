import {ValidationError, z} from "@terreno/api";

export const announcementPlatformSchema = z.enum(["ios", "android", "web"]);

export const announcementImpressionBodySchema = z
  .object({
    platform: announcementPlatformSchema.optional(),
  })
  .strict();

export const announcementClickBodySchema = z
  .object({
    action: z.literal("primaryAction"),
    platform: announcementPlatformSchema.optional(),
  })
  .strict();

// Visibility checks need the platform before the rest of the click body is validated, so hidden
// announcements return 404 regardless of the action.
export const announcementClickPlatformSchema = announcementClickBodySchema
  .pick({platform: true})
  .loose();

const toFieldErrors = (error: z.ZodError): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "body";
    fields[key] ??= issue.message;
  }
  return fields;
};

export const parseAnnouncementBody = <TSchema extends z.ZodType>({
  body,
  schema,
}: {
  body: unknown;
  schema: TSchema;
}): z.output<TSchema> => {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError({
      code: "announcement-body-validation-failed",
      detail: "The request body did not match the announcement schema",
      fields: toFieldErrors(parsed.error),
      title: "Validation failed",
    });
  }
  return parsed.data;
};
