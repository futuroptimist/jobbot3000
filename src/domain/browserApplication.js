import { z } from "zod";

export const browserApplicationLifecycleStatusSchema = z.enum([
  "applied",
  "outreach_sent",
  "recruiter_screen",
  "technical_screen",
  "onsite_loop",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);

export const browserApplicationOriginSchema = z.enum([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
]);

export const browserApplicationLifecycleEventTypeSchema = z.enum([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
  "employer_response_received",
  "recruiter_screen",
  "assessment_take_home",
  "technical_interview",
  "onsite_final_loop",
  "offer_received",
  "offer_negotiating",
  "employer_rejected",
  "candidate_withdrew",
  "offer_declined",
  "offer_expired_rescinded",
  "offer_accepted",
  "closed_archived",
  "application_reopened",
  "status_changed",
  "migration_status_snapshot",
]);

export const browserApplicationOccurredAtPrecisionSchema = z.enum([
  "instant",
  "date",
  "unknown",
]);

const isoDateTimeSchema = z.string().datetime({ offset: true });
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stableDateOrDateTimeSchema = z.union([isoDateSchema, isoDateTimeSchema]);
const requiredStringSchema = z.string().trim().min(1);
const optionalTrimmedStringSchema = requiredStringSchema.optional();
const idSchema = requiredStringSchema;

export const browserApplicationContactSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  name: optionalTrimmedStringSchema,
  role: optionalTrimmedStringSchema,
  email: z.string().email().optional(),
  phone: optionalTrimmedStringSchema,
  profileUrl: z.string().url().optional(),
  company: optionalTrimmedStringSchema,
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationOutreachMessageSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  contactId: idSchema.optional(),
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["email", "linkedin", "phone", "sms", "other"]),
  subject: optionalTrimmedStringSchema,
  body: optionalTrimmedStringSchema,
  sentAt: isoDateTimeSchema.optional(),
  receivedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationLifecycleEventSchema = z
  .object({
    id: idSchema,
    applicationId: idSchema,
    status: browserApplicationLifecycleStatusSchema,
    occurredAt: stableDateOrDateTimeSchema,
    source: z.enum([
      "manual",
      "csv_import",
      "json_import",
      "ndjson_import",
      "sqlite_migration",
      "browser_migration",
      "reconciliation",
    ]),
    note: optionalTrimmedStringSchema,
    eventType: browserApplicationLifecycleEventTypeSchema,
    rawEventType: optionalTrimmedStringSchema,
    previousStatus: browserApplicationLifecycleStatusSchema.optional(),
    occurredAtPrecision: browserApplicationOccurredAtPrecisionSchema,
    inferred: z.boolean(),
    supersedesEventId: optionalTrimmedStringSchema,
    stageLabel: optionalTrimmedStringSchema,
    channel: optionalTrimmedStringSchema,
    actor: optionalTrimmedStringSchema,
    sourceArtifact: optionalTrimmedStringSchema,
    requiresUserAction: z.boolean().optional(),
    actionStatus: optionalTrimmedStringSchema,
    dueAt: isoDateTimeSchema.optional(),
    noAiRequired: z.boolean().optional(),
    details: optionalTrimmedStringSchema,
    createdAt: isoDateTimeSchema,
  })
  .superRefine((event, ctx) => {
    if (
      event.occurredAtPrecision === "instant" &&
      !isoDateTimeSchema.safeParse(event.occurredAt).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "instant occurredAt must be an ISO datetime with offset",
        path: ["occurredAt"],
      });
    }
    if (
      event.occurredAtPrecision === "date" &&
      !isoDateSchema.safeParse(event.occurredAt).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date occurredAt must be YYYY-MM-DD",
        path: ["occurredAt"],
      });
    }
  });

export const browserApplicationInterviewSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  contactIds: z.array(idSchema).default([]),
  stage: z.enum([
    "recruiter_screen",
    "technical_screen",
    "onsite_loop",
    "other",
  ]),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.optional(),
  location: optionalTrimmedStringSchema,
  meetingUrl: z.string().url().optional(),
  preparationNotes: optionalTrimmedStringSchema,
  outcome: z
    .enum(["scheduled", "completed", "cancelled", "no_show"])
    .default("scheduled"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationOfferSchema = z
  .object({
    id: idSchema,
    applicationId: idSchema,
    status: z.enum([
      "draft",
      "received",
      "negotiating",
      "accepted",
      "declined",
      "expired",
    ]),
    baseSalaryMin: z.number().nonnegative().optional(),
    baseSalaryMax: z.number().nonnegative().optional(),
    currency: z.string().trim().length(3).optional(),
    equity: optionalTrimmedStringSchema,
    bonus: optionalTrimmedStringSchema,
    deadlineAt: isoDateTimeSchema.optional(),
    notes: optionalTrimmedStringSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine(
    ({ baseSalaryMin, baseSalaryMax }) =>
      baseSalaryMin === undefined ||
      baseSalaryMax === undefined ||
      baseSalaryMin <= baseSalaryMax,
    {
      message: "baseSalaryMin must be less than or equal to baseSalaryMax",
      path: ["baseSalaryMin"],
    },
  );

export const browserApplicationArtifactSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  kind: z.enum([
    "job_posting",
    "resume",
    "cover_letter",
    "portfolio",
    "take_home",
    "link",
    "other",
  ]),
  name: requiredStringSchema,
  url: z.string().url().optional(),
  blobKey: optionalTrimmedStringSchema,
  mimeType: optionalTrimmedStringSchema,
  private: z.boolean().default(true),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationReminderSchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  contactId: idSchema.optional(),
  dueAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  summary: requiredStringSchema,
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationSettingsSchema = z.object({
  id: z.literal("local"),
  schemaVersion: z.literal(2),
  locale: optionalTrimmedStringSchema,
  timezone: optionalTrimmedStringSchema,
  defaultExportFormat: z.enum(["json", "ndjson", "csv"]).default("json"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationSchema = z.object({
  id: idSchema,
  company: requiredStringSchema,
  role: requiredStringSchema,
  status: browserApplicationLifecycleStatusSchema,
  source: optionalTrimmedStringSchema,
  origin: browserApplicationOriginSchema,
  postingUrl: z.string().url().optional(),
  location: optionalTrimmedStringSchema,
  remote: z.boolean().optional(),
  compensationText: optionalTrimmedStringSchema,
  appliedAt: isoDateTimeSchema.optional(),
  followUpDate: isoDateTimeSchema.optional(),
  closedAt: isoDateTimeSchema.optional(),
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

const addDuplicateIdIssues = (ctx, storeName, records) => {
  const seen = new Set();

  records.forEach(({ id }, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${storeName} id: ${id}`,
        path: [storeName, index, "id"],
      });
      return;
    }

    seen.add(id);
  });
};

const addApplicationReferenceIssues = (
  ctx,
  storeName,
  records,
  applicationIds,
) => {
  records.forEach(({ applicationId }, index) => {
    if (!applicationIds.has(applicationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown applicationId: ${applicationId}`,
        path: [storeName, index, "applicationId"],
      });
    }
  });
};

const addContactReferenceIssues = (ctx, storeName, records, contactIds) => {
  records.forEach(({ contactId }, index) => {
    if (contactId !== undefined && !contactIds.has(contactId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown contactId: ${contactId}`,
        path: [storeName, index, "contactId"],
      });
    }
  });
};

export const browserApplicationV1SettingsSchema =
  browserApplicationSettingsSchema.extend({
    schemaVersion: z.literal(1),
  });
export const browserApplicationV1Schema = browserApplicationSchema.omit({
  origin: true,
});
export const browserApplicationV1LifecycleEventSchema = z
  .object({
    id: idSchema,
    applicationId: idSchema,
    status: browserApplicationLifecycleStatusSchema,
    occurredAt: isoDateTimeSchema,
    source: z.enum([
      "manual",
      "csv_import",
      "json_import",
      "ndjson_import",
      "sqlite_migration",
      "browser_migration",
      "reconciliation",
    ]),
    note: optionalTrimmedStringSchema,
    eventType: optionalTrimmedStringSchema,
    stageLabel: optionalTrimmedStringSchema,
    channel: optionalTrimmedStringSchema,
    actor: optionalTrimmedStringSchema,
    sourceArtifact: optionalTrimmedStringSchema,
    requiresUserAction: z.boolean().optional(),
    actionStatus: optionalTrimmedStringSchema,
    dueAt: isoDateTimeSchema.optional(),
    noAiRequired: z.boolean().optional(),
    details: optionalTrimmedStringSchema,
    createdAt: isoDateTimeSchema,
  })
  .passthrough();

export const browserApplicationV1ExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: isoDateTimeSchema,
  applications: z.array(browserApplicationV1Schema),
  contacts: z.array(browserApplicationContactSchema).default([]),
  outreachMessages: z
    .array(browserApplicationOutreachMessageSchema)
    .default([]),
  lifecycleEvents: z
    .array(browserApplicationV1LifecycleEventSchema)
    .default([]),
  interviews: z.array(browserApplicationInterviewSchema).default([]),
  offers: z.array(browserApplicationOfferSchema).default([]),
  artifacts: z.array(browserApplicationArtifactSchema).default([]),
  reminders: z.array(browserApplicationReminderSchema).default([]),
  settings: browserApplicationV1SettingsSchema.optional(),
});

export const browserApplicationExportSchema = z
  .object({
    schemaVersion: z.literal(2),
    exportedAt: isoDateTimeSchema,
    applications: z.array(browserApplicationSchema),
    contacts: z.array(browserApplicationContactSchema).default([]),
    outreachMessages: z
      .array(browserApplicationOutreachMessageSchema)
      .default([]),
    lifecycleEvents: z
      .array(browserApplicationLifecycleEventSchema)
      .default([]),
    interviews: z.array(browserApplicationInterviewSchema).default([]),
    offers: z.array(browserApplicationOfferSchema).default([]),
    artifacts: z.array(browserApplicationArtifactSchema).default([]),
    reminders: z.array(browserApplicationReminderSchema).default([]),
    settings: browserApplicationSettingsSchema.optional(),
  })
  .superRefine((exportData, ctx) => {
    const keyedStores = [
      ["applications", exportData.applications],
      ["contacts", exportData.contacts],
      ["outreachMessages", exportData.outreachMessages],
      ["lifecycleEvents", exportData.lifecycleEvents],
      ["interviews", exportData.interviews],
      ["offers", exportData.offers],
      ["artifacts", exportData.artifacts],
      ["reminders", exportData.reminders],
    ];

    keyedStores.forEach(([storeName, records]) => {
      addDuplicateIdIssues(ctx, storeName, records);
    });

    const applicationIds = new Set(
      exportData.applications.map((application) => application.id),
    );
    const contactIds = new Set(
      exportData.contacts.map((contact) => contact.id),
    );
    const applicationScopedStores = [
      ["contacts", exportData.contacts],
      ["outreachMessages", exportData.outreachMessages],
      ["lifecycleEvents", exportData.lifecycleEvents],
      ["interviews", exportData.interviews],
      ["offers", exportData.offers],
      ["artifacts", exportData.artifacts],
      ["reminders", exportData.reminders],
    ];

    applicationScopedStores.forEach(([storeName, records]) => {
      addApplicationReferenceIssues(ctx, storeName, records, applicationIds);
    });

    addContactReferenceIssues(
      ctx,
      "outreachMessages",
      exportData.outreachMessages,
      contactIds,
    );
    addContactReferenceIssues(
      ctx,
      "reminders",
      exportData.reminders,
      contactIds,
    );

    exportData.interviews.forEach(
      ({ contactIds: interviewContactIds }, index) => {
        interviewContactIds.forEach((contactId, contactIndex) => {
          if (!contactIds.has(contactId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Unknown contactId: ${contactId}`,
              path: ["interviews", index, "contactIds", contactIndex],
            });
          }
        });
      },
    );

    const eventsById = new Map(
      exportData.lifecycleEvents.map((event) => [event.id, event]),
    );
    exportData.lifecycleEvents.forEach((event, index) => {
      if (!event.supersedesEventId) return;
      const superseded = eventsById.get(event.supersedesEventId);
      if (!superseded) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown supersedesEventId: ${event.supersedesEventId}`,
          path: ["lifecycleEvents", index, "supersedesEventId"],
        });
        return;
      }
      if (superseded.applicationId !== event.applicationId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "supersedesEventId must reference the same application",
          path: ["lifecycleEvents", index, "supersedesEventId"],
        });
      const seen = new Set([event.id]);
      let cursor = superseded;
      while (cursor?.supersedesEventId) {
        if (seen.has(cursor.supersedesEventId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "supersession chain must be acyclic",
            path: ["lifecycleEvents", index, "supersedesEventId"],
          });
          break;
        }
        seen.add(cursor.supersedesEventId);
        cursor = eventsById.get(cursor.supersedesEventId);
      }
    });
  });
