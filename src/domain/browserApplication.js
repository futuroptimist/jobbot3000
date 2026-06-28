import { z } from "zod";

export const browserApplicationLifecycleStatusSchema = z.enum([
  "Applied",
  "Outreach sent",
  "Recruiter screen",
  "Technical screen",
  "Onsite / loop",
  "Offer",
  "Accepted",
  "Rejected",
  "Withdrawn",
  "Closed / archived",
]);

export const browserApplicationIdSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().datetime({ offset: true });

const optionalTrimmedStringSchema = z.string().trim().min(1).optional();

export const browserContactSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  fullName: optionalTrimmedStringSchema,
  email: z.string().email().optional(),
  phone: optionalTrimmedStringSchema,
  company: optionalTrimmedStringSchema,
  title: optionalTrimmedStringSchema,
  source: optionalTrimmedStringSchema,
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationSchema = z.object({
  id: browserApplicationIdSchema,
  company: z.string().trim().min(1),
  roleTitle: z.string().trim().min(1),
  status: browserApplicationLifecycleStatusSchema,
  source: optionalTrimmedStringSchema,
  postingUrl: z.string().url().optional(),
  location: optionalTrimmedStringSchema,
  compensation: optionalTrimmedStringSchema,
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  tags: z.array(z.string().trim().min(1)).default([]),
  notes: optionalTrimmedStringSchema,
  appliedAt: isoDateTimeSchema.optional(),
  archivedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserOutreachMessageSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  contactId: browserApplicationIdSchema.optional(),
  channel: z.enum(["email", "linkedin", "phone", "in-person", "other"]),
  direction: z.enum(["inbound", "outbound"]),
  subject: optionalTrimmedStringSchema,
  body: optionalTrimmedStringSchema,
  sentAt: isoDateTimeSchema.optional(),
  receivedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserLifecycleEventSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  type: z.enum([
    "status_change",
    "note",
    "import",
    "export",
    "reminder",
    "artifact",
  ]),
  status: browserApplicationLifecycleStatusSchema.optional(),
  occurredAt: isoDateTimeSchema,
  note: optionalTrimmedStringSchema,
  metadata: z.record(z.unknown()).default({}),
});

export const browserInterviewSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  contactIds: z.array(browserApplicationIdSchema).default([]),
  stage: z.enum([
    "recruiter",
    "technical",
    "onsite",
    "hiring-manager",
    "other",
  ]),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.optional(),
  location: optionalTrimmedStringSchema,
  meetingUrl: z.string().url().optional(),
  notes: optionalTrimmedStringSchema,
  outcome: z
    .enum(["pending", "passed", "rejected", "cancelled"])
    .default("pending"),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserOfferSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  status: z.enum([
    "draft",
    "received",
    "negotiating",
    "accepted",
    "declined",
    "expired",
  ]),
  baseSalary: z.number().nonnegative().optional(),
  currency: z.string().length(3).default("USD"),
  equity: optionalTrimmedStringSchema,
  bonus: optionalTrimmedStringSchema,
  deadlineAt: isoDateTimeSchema.optional(),
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserArtifactLinkSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  kind: z.enum([
    "posting",
    "resume",
    "cover-letter",
    "portfolio",
    "note",
    "other",
  ]),
  label: z.string().trim().min(1),
  url: z.string().url().optional(),
  privateBlobId: browserApplicationIdSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserReminderSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  contactId: browserApplicationIdSchema.optional(),
  dueAt: isoDateTimeSchema,
  title: z.string().trim().min(1),
  completedAt: isoDateTimeSchema.optional(),
  notes: optionalTrimmedStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const browserSettingsSchema = z.object({
  id: z.literal("settings"),
  schemaVersion: z.literal(1),
  locale: z.string().default("en-US"),
  timezone: z.string().default("UTC"),
  defaultExportFormat: z.enum(["json", "ndjson", "csv"]).default("json"),
  updatedAt: isoDateTimeSchema,
});

export const browserApplicationDatabaseSchema = z.object({
  schemaVersion: z.literal(1),
  applications: z.array(browserApplicationSchema).default([]),
  contacts: z.array(browserContactSchema).default([]),
  outreachMessages: z.array(browserOutreachMessageSchema).default([]),
  lifecycleEvents: z.array(browserLifecycleEventSchema).default([]),
  interviews: z.array(browserInterviewSchema).default([]),
  offers: z.array(browserOfferSchema).default([]),
  artifactLinks: z.array(browserArtifactLinkSchema).default([]),
  reminders: z.array(browserReminderSchema).default([]),
  settings: browserSettingsSchema,
});
