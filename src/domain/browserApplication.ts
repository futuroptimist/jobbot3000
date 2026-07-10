import { z } from "zod";

import {
  browserApplicationArtifactSchema as runtimeBrowserApplicationArtifactSchema,
  browserApplicationContactSchema as runtimeBrowserApplicationContactSchema,
  browserApplicationExportSchema as runtimeBrowserApplicationExportSchema,
  browserApplicationExportV1Schema as runtimeBrowserApplicationExportV1Schema,
  browserApplicationExportV2Schema as runtimeBrowserApplicationExportV2Schema,
  browserApplicationOriginSchema as runtimeBrowserApplicationOriginSchema,
  browserApplicationLifecycleEventTypeSchema as runtimeBrowserApplicationLifecycleEventTypeSchema,
  browserApplicationInterviewSchema as runtimeBrowserApplicationInterviewSchema,
  browserApplicationLifecycleEventSchema as runtimeBrowserApplicationLifecycleEventSchema,
  browserApplicationLifecycleStatusSchema as runtimeBrowserApplicationLifecycleStatusSchema,
  browserApplicationOfferSchema as runtimeBrowserApplicationOfferSchema,
  browserApplicationOutreachMessageSchema as runtimeBrowserApplicationOutreachMessageSchema,
  browserApplicationReminderSchema as runtimeBrowserApplicationReminderSchema,
  browserApplicationSchema as runtimeBrowserApplicationSchema,
  browserApplicationSettingsSchema as runtimeBrowserApplicationSettingsSchema,
} from "./browserApplication.js";

export const browserApplicationArtifactSchema =
  runtimeBrowserApplicationArtifactSchema;
export const browserApplicationContactSchema =
  runtimeBrowserApplicationContactSchema;
export const browserApplicationExportSchema =
  runtimeBrowserApplicationExportSchema;
export const browserApplicationExportV1Schema =
  runtimeBrowserApplicationExportV1Schema;
export const browserApplicationExportV2Schema =
  runtimeBrowserApplicationExportV2Schema;
export const browserApplicationOriginSchema =
  runtimeBrowserApplicationOriginSchema;
export const browserApplicationLifecycleEventTypeSchema =
  runtimeBrowserApplicationLifecycleEventTypeSchema;
export const browserApplicationInterviewSchema =
  runtimeBrowserApplicationInterviewSchema;
export const browserApplicationLifecycleEventSchema =
  runtimeBrowserApplicationLifecycleEventSchema;
export const browserApplicationLifecycleStatusSchema =
  runtimeBrowserApplicationLifecycleStatusSchema;
export const browserApplicationOfferSchema =
  runtimeBrowserApplicationOfferSchema;
export const browserApplicationOutreachMessageSchema =
  runtimeBrowserApplicationOutreachMessageSchema;
export const browserApplicationReminderSchema =
  runtimeBrowserApplicationReminderSchema;
export const browserApplicationSchema = runtimeBrowserApplicationSchema;
export const browserApplicationSettingsSchema =
  runtimeBrowserApplicationSettingsSchema;

export type BrowserApplicationOrigin = z.infer<
  typeof browserApplicationOriginSchema
>;
export type BrowserApplicationLifecycleEventType = z.infer<
  typeof browserApplicationLifecycleEventTypeSchema
>;
export type BrowserApplicationLifecycleStatus = z.infer<
  typeof browserApplicationLifecycleStatusSchema
>;
export type BrowserApplication = z.infer<typeof browserApplicationSchema>;
export type BrowserApplicationContact = z.infer<
  typeof browserApplicationContactSchema
>;
export type BrowserApplicationOutreachMessage = z.infer<
  typeof browserApplicationOutreachMessageSchema
>;
export type BrowserApplicationLifecycleEvent = z.infer<
  typeof browserApplicationLifecycleEventSchema
>;
export type BrowserApplicationInterview = z.infer<
  typeof browserApplicationInterviewSchema
>;
export type BrowserApplicationOffer = z.infer<
  typeof browserApplicationOfferSchema
>;
export type BrowserApplicationArtifact = z.infer<
  typeof browserApplicationArtifactSchema
>;
export type BrowserApplicationReminder = z.infer<
  typeof browserApplicationReminderSchema
>;
export type BrowserApplicationSettings = z.infer<
  typeof browserApplicationSettingsSchema
>;
export type BrowserApplicationExport = z.infer<
  typeof browserApplicationExportSchema
>;
