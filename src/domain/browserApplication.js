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

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requiredStringSchema = z.string().trim().min(1);
const optionalTrimmedStringSchema = requiredStringSchema.optional();
const idSchema = requiredStringSchema;

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

export const browserApplicationLifecycleEventV1Schema = z.object({
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
  occurredAtHasTime: z.boolean().optional(),
  dueAtHasTime: z.boolean().optional(),
});

export const browserApplicationLifecycleEventSchema = z
  .object({
    id: idSchema,
    applicationId: idSchema,
    status: browserApplicationLifecycleStatusSchema.optional(),
    previousStatus: browserApplicationLifecycleStatusSchema.optional(),
    occurredAt: z.union([isoDateTimeSchema, isoDateSchema]),
    occurredAtPrecision: browserApplicationOccurredAtPrecisionSchema,
    inferred: z.boolean(),
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
    supersedesEventId: optionalTrimmedStringSchema,
    stageLabel: optionalTrimmedStringSchema,
    channel: optionalTrimmedStringSchema,
    actor: optionalTrimmedStringSchema,
    sourceArtifact: optionalTrimmedStringSchema,
    requiresUserAction: z.boolean().optional(),
    actionStatus: optionalTrimmedStringSchema,
    actionInferred: z.boolean().optional(),
    dueAt: isoDateTimeSchema.optional(),
    noAiRequired: z.boolean().optional(),
    details: optionalTrimmedStringSchema,
    createdAt: isoDateTimeSchema,
  })
  .superRefine((event, ctx) => {
    if (
      event.occurredAtPrecision === "instant" &&
      !isoDateTimeSchema.safeParse(event.occurredAt).success
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "instant occurredAt requires an ISO datetime with offset",
        path: ["occurredAt"],
      });
    if (
      event.occurredAtPrecision === "date" &&
      !isoDateSchema.safeParse(event.occurredAt).success
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date occurredAt requires YYYY-MM-DD",
        path: ["occurredAt"],
      });
    if (
      event.occurredAtPrecision === "unknown" &&
      !z.union([isoDateTimeSchema, isoDateSchema]).safeParse(event.occurredAt)
        .success
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unknown occurredAt requires a stable date or datetime anchor",
        path: ["occurredAt"],
      });
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

export const browserApplicationSettingsV1Schema = z.object({
  id: z.literal("local"),
  schemaVersion: z.literal(1),
  locale: optionalTrimmedStringSchema,
  timezone: optionalTrimmedStringSchema,
  defaultExportFormat: z.enum(["json", "ndjson", "csv"]).default("json"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationV1Schema = z.object({
  id: idSchema,
  company: requiredStringSchema,
  role: requiredStringSchema,
  status: browserApplicationLifecycleStatusSchema,
  source: optionalTrimmedStringSchema,
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

export const browserApplicationSettingsSchema =
  browserApplicationSettingsV1Schema.extend({
    schemaVersion: z.literal(2),
  });

export const browserApplicationSchema = browserApplicationV1Schema.extend({
  origin: browserApplicationOriginSchema,
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

export const browserApplicationExportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: isoDateTimeSchema,
    applications: z.array(browserApplicationV1Schema),
    contacts: z.array(browserApplicationContactSchema).default([]),
    outreachMessages: z
      .array(browserApplicationOutreachMessageSchema)
      .default([]),
    lifecycleEvents: z
      .array(browserApplicationLifecycleEventV1Schema)
      .default([]),
    interviews: z.array(browserApplicationInterviewSchema).default([]),
    offers: z.array(browserApplicationOfferSchema).default([]),
    artifacts: z.array(browserApplicationArtifactSchema).default([]),
    reminders: z.array(browserApplicationReminderSchema).default([]),
    settings: browserApplicationSettingsV1Schema.optional(),
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
  });

const addSupersessionIssues = (exportData, ctx) => {
  const eventsById = new Map(
    exportData.lifecycleEvents.map((event) => [event.id, event]),
  );
  exportData.lifecycleEvents.forEach((event, index) => {
    if (!event.supersedesEventId) return;
    const referenced = eventsById.get(event.supersedesEventId);
    if (!referenced) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown supersedesEventId: ${event.supersedesEventId}`,
        path: ["lifecycleEvents", index, "supersedesEventId"],
      });
      return;
    }
    if (referenced.applicationId !== event.applicationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "supersedesEventId must reference an event for the same application",
        path: ["lifecycleEvents", index, "supersedesEventId"],
      });
    }
    const seen = new Set([event.id]);
    let current = referenced;
    while (current?.supersedesEventId) {
      if (seen.has(current.supersedesEventId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "supersession chain must be acyclic",
          path: ["lifecycleEvents", index, "supersedesEventId"],
        });
        break;
      }
      seen.add(current.supersedesEventId);
      current = eventsById.get(current.supersedesEventId);
    }
  });
};

export const browserApplicationExportV2Schema = z
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
    [
      ["applications", exportData.applications],
      ["contacts", exportData.contacts],
      ["outreachMessages", exportData.outreachMessages],
      ["lifecycleEvents", exportData.lifecycleEvents],
      ["interviews", exportData.interviews],
      ["offers", exportData.offers],
      ["artifacts", exportData.artifacts],
      ["reminders", exportData.reminders],
    ].forEach(([storeName, records]) =>
      addDuplicateIdIssues(ctx, storeName, records),
    );
    const applicationIds = new Set(exportData.applications.map(({ id }) => id));
    const contactIds = new Set(exportData.contacts.map(({ id }) => id));
    [
      ["contacts", exportData.contacts],
      ["outreachMessages", exportData.outreachMessages],
      ["lifecycleEvents", exportData.lifecycleEvents],
      ["interviews", exportData.interviews],
      ["offers", exportData.offers],
      ["artifacts", exportData.artifacts],
      ["reminders", exportData.reminders],
    ].forEach(([storeName, records]) =>
      addApplicationReferenceIssues(ctx, storeName, records, applicationIds),
    );
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
    exportData.interviews.forEach(({ contactIds: ids }, index) =>
      ids.forEach((contactId, contactIndex) => {
        if (!contactIds.has(contactId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown contactId: ${contactId}`,
            path: ["interviews", index, "contactIds", contactIndex],
          });
      }),
    );
    addSupersessionIssues(exportData, ctx);
  });

const upgradeLegacyExportForCompatibility = (input) => {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1)
    return input;
  const now = input.exportedAt ?? new Date(0).toISOString();
  const applications = (input.applications ?? []).map((application) => ({
    ...application,
    origin:
      application.source?.trim().toLowerCase() === "referral"
        ? "referral"
        : application.appliedAt
          ? "application_submitted"
          : "other_unknown",
  }));
  const lifecycleEvents = (input.lifecycleEvents ?? []).map((event) => ({
    ...event,
    eventType: event.eventType || "status_changed",
    occurredAtPrecision: event.occurredAtHasTime === false ? "date" : "instant",
    occurredAt:
      event.occurredAtHasTime === false
        ? String(event.occurredAt).slice(0, 10)
        : event.occurredAt,
    inferred: false,
    createdAt: event.createdAt ?? now,
  }));
  return {
    ...input,
    schemaVersion: 2,
    applications,
    lifecycleEvents,
    settings: input.settings
      ? { ...input.settings, schemaVersion: 2 }
      : undefined,
  };
};

export const browserApplicationExportSchema = z.preprocess(
  upgradeLegacyExportForCompatibility,
  browserApplicationExportV2Schema,
);
