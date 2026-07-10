import { z } from "zod";

import {
  browserApplicationArtifactSchema as runtimeBrowserApplicationArtifactSchema,
  browserApplicationContactSchema as runtimeBrowserApplicationContactSchema,
  browserApplicationExportSchema as runtimeBrowserApplicationExportSchema,
  browserApplicationInterviewSchema as runtimeBrowserApplicationInterviewSchema,
  browserApplicationLifecycleEventSchema as runtimeBrowserApplicationLifecycleEventSchema,
  browserApplicationLifecycleEventTypeSchema as runtimeBrowserApplicationLifecycleEventTypeSchema,
  browserApplicationLifecycleStatusSchema as runtimeBrowserApplicationLifecycleStatusSchema,
  browserApplicationOriginSchema as runtimeBrowserApplicationOriginSchema,
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
export const browserApplicationInterviewSchema =
  runtimeBrowserApplicationInterviewSchema;
export const browserApplicationLifecycleEventSchema =
  runtimeBrowserApplicationLifecycleEventSchema;
export const browserApplicationLifecycleEventTypeSchema =
  runtimeBrowserApplicationLifecycleEventTypeSchema;
export const browserApplicationLifecycleStatusSchema =
  runtimeBrowserApplicationLifecycleStatusSchema;
export const browserApplicationOriginSchema =
  runtimeBrowserApplicationOriginSchema;
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
