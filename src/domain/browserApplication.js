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

const isoDateTimeSchema = z.string().datetime();
const optionalTrimmedStringSchema = z.string().trim().min(1).optional();
const idSchema = z.string().trim().min(1);

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

export const browserApplicationLifecycleEventSchema = z.object({
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
  createdAt: isoDateTimeSchema,
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

export const browserApplicationOfferSchema = z.object({
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
});

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
  name: idSchema,
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
  summary: idSchema,
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationSettingsSchema = z.object({
  id: z.literal("local"),
  schemaVersion: z.number().int().positive(),
  locale: optionalTrimmedStringSchema,
  timezone: optionalTrimmedStringSchema,
  defaultExportFormat: z.enum(["json", "ndjson", "csv"]).default("json"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationSchema = z.object({
  id: idSchema,
  company: idSchema,
  role: idSchema,
  status: browserApplicationLifecycleStatusSchema,
  source: optionalTrimmedStringSchema,
  postingUrl: z.string().url().optional(),
  location: optionalTrimmedStringSchema,
  remote: z.boolean().optional(),
  compensationText: optionalTrimmedStringSchema,
  appliedAt: isoDateTimeSchema.optional(),
  closedAt: isoDateTimeSchema.optional(),
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: isoDateTimeSchema,
  applications: z.array(browserApplicationSchema),
  contacts: z.array(browserApplicationContactSchema).default([]),
  outreachMessages: z
    .array(browserApplicationOutreachMessageSchema)
    .default([]),
  lifecycleEvents: z.array(browserApplicationLifecycleEventSchema).default([]),
  interviews: z.array(browserApplicationInterviewSchema).default([]),
  offers: z.array(browserApplicationOfferSchema).default([]),
  artifacts: z.array(browserApplicationArtifactSchema).default([]),
  reminders: z.array(browserApplicationReminderSchema).default([]),
  settings: browserApplicationSettingsSchema.optional(),
});
