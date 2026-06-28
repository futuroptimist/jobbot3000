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

export const browserApplicationLifecycleStatusLabels = Object.freeze({
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
});

export const browserApplicationIdSchema = z.string().min(1).max(128);
export const browserApplicationDateTimeSchema = z.string().datetime();
export const browserApplicationDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "expected YYYY-MM-DD date",
  });

const optionalTrimmedString = z.string().trim().min(1).optional();
const stringListSchema = z.array(z.string().trim().min(1)).default([]);

export const browserContactSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  fullName: optionalTrimmedString,
  company: optionalTrimmedString,
  role: optionalTrimmedString,
  email: z.string().email().optional(),
  phone: optionalTrimmedString,
  profileUrl: z.string().url().optional(),
  notes: optionalTrimmedString,
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserOutreachMessageSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  contactId: browserApplicationIdSchema.optional(),
  channel: z.enum(["email", "linkedin", "referral", "phone", "other"]),
  direction: z.enum(["inbound", "outbound"]),
  subject: optionalTrimmedString,
  body: optionalTrimmedString,
  sentAt: browserApplicationDateTimeSchema.optional(),
  receivedAt: browserApplicationDateTimeSchema.optional(),
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserLifecycleEventSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  status: browserApplicationLifecycleStatusSchema,
  occurredAt: browserApplicationDateTimeSchema,
  source: z.enum(["manual", "import", "system"]).default("manual"),
  note: optionalTrimmedString,
  metadata: z.record(z.unknown()).default({}),
});

export const browserInterviewSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema,
  contactIds: z.array(browserApplicationIdSchema).default([]),
  stage: z.enum([
    "recruiter_screen",
    "technical_screen",
    "onsite_loop",
    "other",
  ]),
  scheduledStart: browserApplicationDateTimeSchema,
  scheduledEnd: browserApplicationDateTimeSchema.optional(),
  location: optionalTrimmedString,
  meetingUrl: z.string().url().optional(),
  notes: optionalTrimmedString,
  outcome: z
    .enum(["scheduled", "completed", "cancelled", "no_show"])
    .default("scheduled"),
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
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
  receivedAt: browserApplicationDateTimeSchema.optional(),
  respondedAt: browserApplicationDateTimeSchema.optional(),
  baseSalary: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  equity: optionalTrimmedString,
  bonus: optionalTrimmedString,
  notes: optionalTrimmedString,
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserArtifactSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  kind: z.enum([
    "job_posting",
    "resume",
    "cover_letter",
    "portfolio",
    "email",
    "note",
    "other",
  ]),
  label: z.string().trim().min(1),
  url: z.string().url().optional(),
  blobKey: browserApplicationIdSchema.optional(),
  mimeType: optionalTrimmedString,
  private: z.boolean().default(true),
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserReminderSchema = z.object({
  id: browserApplicationIdSchema,
  applicationId: browserApplicationIdSchema.optional(),
  contactId: browserApplicationIdSchema.optional(),
  dueAt: browserApplicationDateTimeSchema,
  label: z.string().trim().min(1),
  completedAt: browserApplicationDateTimeSchema.optional(),
  snoozedUntil: browserApplicationDateTimeSchema.optional(),
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserSettingsSchema = z.object({
  id: z.literal("default"),
  schemaVersion: z.literal(1),
  locale: z.string().default("en-US"),
  timezone: z.string().default("UTC"),
  redactionEnabled: z.boolean().default(true),
  backupReminderDays: z.number().int().positive().default(14),
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserApplicationSchema = z.object({
  id: browserApplicationIdSchema,
  company: z.string().trim().min(1),
  roleTitle: z.string().trim().min(1),
  status: browserApplicationLifecycleStatusSchema,
  source: optionalTrimmedString,
  jobUrl: z.string().url().optional(),
  location: optionalTrimmedString,
  level: optionalTrimmedString,
  compensation: optionalTrimmedString,
  tags: stringListSchema,
  notes: optionalTrimmedString,
  appliedOn: browserApplicationDateSchema.optional(),
  closedOn: browserApplicationDateSchema.optional(),
  createdAt: browserApplicationDateTimeSchema,
  updatedAt: browserApplicationDateTimeSchema,
});

export const browserApplicationExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: browserApplicationDateTimeSchema,
  applications: z.array(browserApplicationSchema),
  contacts: z.array(browserContactSchema).default([]),
  outreachMessages: z.array(browserOutreachMessageSchema).default([]),
  lifecycleEvents: z.array(browserLifecycleEventSchema).default([]),
  interviews: z.array(browserInterviewSchema).default([]),
  offers: z.array(browserOfferSchema).default([]),
  artifacts: z.array(browserArtifactSchema).default([]),
  reminders: z.array(browserReminderSchema).default([]),
  settings: browserSettingsSchema.optional(),
});
