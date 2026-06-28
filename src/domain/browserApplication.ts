import { z } from "zod";

import {
  browserApplicationDateSchema as runtimeBrowserApplicationDateSchema,
  browserApplicationDateTimeSchema as runtimeBrowserApplicationDateTimeSchema,
  browserApplicationExportSchema as runtimeBrowserApplicationExportSchema,
  browserApplicationIdSchema as runtimeBrowserApplicationIdSchema,
  browserApplicationLifecycleStatusLabels as runtimeBrowserApplicationLifecycleStatusLabels,
  browserApplicationLifecycleStatusSchema as runtimeBrowserApplicationLifecycleStatusSchema,
  browserApplicationSchema as runtimeBrowserApplicationSchema,
  browserArtifactSchema as runtimeBrowserArtifactSchema,
  browserContactSchema as runtimeBrowserContactSchema,
  browserInterviewSchema as runtimeBrowserInterviewSchema,
  browserLifecycleEventSchema as runtimeBrowserLifecycleEventSchema,
  browserOfferSchema as runtimeBrowserOfferSchema,
  browserOutreachMessageSchema as runtimeBrowserOutreachMessageSchema,
  browserReminderSchema as runtimeBrowserReminderSchema,
  browserSettingsSchema as runtimeBrowserSettingsSchema,
} from "./browserApplication.js";

export const browserApplicationDateSchema = runtimeBrowserApplicationDateSchema;
export const browserApplicationDateTimeSchema =
  runtimeBrowserApplicationDateTimeSchema;
export const browserApplicationExportSchema =
  runtimeBrowserApplicationExportSchema;
export const browserApplicationIdSchema = runtimeBrowserApplicationIdSchema;
export const browserApplicationLifecycleStatusLabels =
  runtimeBrowserApplicationLifecycleStatusLabels;
export const browserApplicationLifecycleStatusSchema =
  runtimeBrowserApplicationLifecycleStatusSchema;
export const browserApplicationSchema = runtimeBrowserApplicationSchema;
export const browserArtifactSchema = runtimeBrowserArtifactSchema;
export const browserContactSchema = runtimeBrowserContactSchema;
export const browserInterviewSchema = runtimeBrowserInterviewSchema;
export const browserLifecycleEventSchema = runtimeBrowserLifecycleEventSchema;
export const browserOfferSchema = runtimeBrowserOfferSchema;
export const browserOutreachMessageSchema = runtimeBrowserOutreachMessageSchema;
export const browserReminderSchema = runtimeBrowserReminderSchema;
export const browserSettingsSchema = runtimeBrowserSettingsSchema;

export type BrowserApplicationLifecycleStatus = z.infer<
  typeof browserApplicationLifecycleStatusSchema
>;
export type BrowserApplication = z.infer<typeof browserApplicationSchema>;
export type BrowserContact = z.infer<typeof browserContactSchema>;
export type BrowserOutreachMessage = z.infer<
  typeof browserOutreachMessageSchema
>;
export type BrowserLifecycleEvent = z.infer<typeof browserLifecycleEventSchema>;
export type BrowserInterview = z.infer<typeof browserInterviewSchema>;
export type BrowserOffer = z.infer<typeof browserOfferSchema>;
export type BrowserArtifact = z.infer<typeof browserArtifactSchema>;
export type BrowserReminder = z.infer<typeof browserReminderSchema>;
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
export type BrowserApplicationExport = z.infer<
  typeof browserApplicationExportSchema
>;
