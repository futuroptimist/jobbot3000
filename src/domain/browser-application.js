import { z } from "zod";

export const browserLifecycleStatusValues = [
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
];

export const browserLifecycleStatusLabels = {
  applied: "Applied",
  outreach_sent: "Outreach sent",
  recruiter_screen: "Recruiter screen",
  technical_screen: "Technical screen",
  onsite_loop: "Onsite / loop",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  closed_archived: "Closed / archived",
};

export const browserLifecycleStatusSchema = z.enum(
  browserLifecycleStatusValues,
);

const idSchema = z.string().min(1);
const dateTimeSchema = z.string().datetime();
const optionalUrlSchema = z.string().url().optional();
const metadataSchema = z.record(z.unknown()).default({});

const baseRecordSchema = z.object({
  id: idSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const browserApplicationSchema = baseRecordSchema.extend({
  company: z.string().min(1),
  role: z.string().min(1),
  status: browserLifecycleStatusSchema,
  source: z.string().optional(),
  jobUrl: optionalUrlSchema,
  location: z.string().optional(),
  compensation: z.string().optional(),
  notes: z.string().optional(),
  archivedAt: dateTimeSchema.optional(),
  metadata: metadataSchema,
});

export const browserContactSchema = baseRecordSchema.extend({
  applicationId: idSchema.optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  organization: z.string().optional(),
  title: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

export const browserOutreachMessageSchema = baseRecordSchema.extend({
  applicationId: idSchema,
  contactId: idSchema.optional(),
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["email", "linkedin", "phone", "text", "other"]),
  subject: z.string().optional(),
  body: z.string().optional(),
  sentAt: dateTimeSchema.optional(),
  receivedAt: dateTimeSchema.optional(),
  metadata: metadataSchema,
});

export const browserLifecycleEventSchema = baseRecordSchema.extend({
  applicationId: idSchema,
  status: browserLifecycleStatusSchema,
  occurredAt: dateTimeSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(["manual", "import", "system"]).default("manual"),
  metadata: metadataSchema,
});

export const browserInterviewSchema = baseRecordSchema.extend({
  applicationId: idSchema,
  contactIds: z.array(idSchema).default([]),
  stage: z.enum([
    "recruiter_screen",
    "technical_screen",
    "onsite_loop",
    "other",
  ]),
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema.optional(),
  location: z.string().optional(),
  meetingUrl: optionalUrlSchema,
  notes: z.string().optional(),
  outcome: z
    .enum(["scheduled", "completed", "cancelled", "no_show"])
    .default("scheduled"),
  metadata: metadataSchema,
});

export const browserOfferSchema = baseRecordSchema.extend({
  applicationId: idSchema,
  status: z.enum([
    "received",
    "negotiating",
    "accepted",
    "declined",
    "expired",
  ]),
  receivedAt: dateTimeSchema.optional(),
  deadlineAt: dateTimeSchema.optional(),
  baseSalary: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  summary: z.string().optional(),
  metadata: metadataSchema,
});

export const browserArtifactSchema = baseRecordSchema.extend({
  applicationId: idSchema.optional(),
  kind: z.enum([
    "resume",
    "cover_letter",
    "job_posting",
    "portfolio",
    "notes",
    "other",
  ]),
  label: z.string().min(1),
  url: optionalUrlSchema,
  privateBlobRef: z.string().optional(),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

export const browserReminderSchema = baseRecordSchema.extend({
  applicationId: idSchema.optional(),
  contactId: idSchema.optional(),
  title: z.string().min(1),
  dueAt: dateTimeSchema,
  completedAt: dateTimeSchema.optional(),
  snoozedUntil: dateTimeSchema.optional(),
  notes: z.string().optional(),
  metadata: metadataSchema,
});

export const browserSettingsSchema = z.object({
  id: z.literal("settings"),
  schemaVersion: z.number().int().positive(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  timezone: z.string().optional(),
  defaultReminderDays: z.number().int().nonnegative().default(7),
  importPreferences: z
    .object({
      duplicateStrategy: z.enum(["skip", "update", "create"]).default("update"),
    })
    .default({}),
  metadata: metadataSchema,
});

export const browserDatabaseExportSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: dateTimeSchema,
  applications: z.array(browserApplicationSchema).default([]),
  contacts: z.array(browserContactSchema).default([]),
  outreachMessages: z.array(browserOutreachMessageSchema).default([]),
  lifecycleEvents: z.array(browserLifecycleEventSchema).default([]),
  interviews: z.array(browserInterviewSchema).default([]),
  offers: z.array(browserOfferSchema).default([]),
  artifacts: z.array(browserArtifactSchema).default([]),
  reminders: z.array(browserReminderSchema).default([]),
  settings: browserSettingsSchema.optional(),
});
