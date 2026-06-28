import { z } from "zod";

import {
  browserApplicationDatabaseSchema as runtimeBrowserApplicationDatabaseSchema,
  browserApplicationLifecycleStatusSchema as runtimeBrowserApplicationLifecycleStatusSchema,
  browserApplicationSchema as runtimeBrowserApplicationSchema,
  browserArtifactLinkSchema as runtimeBrowserArtifactLinkSchema,
  browserContactSchema as runtimeBrowserContactSchema,
  browserInterviewSchema as runtimeBrowserInterviewSchema,
  browserLifecycleEventSchema as runtimeBrowserLifecycleEventSchema,
  browserOfferSchema as runtimeBrowserOfferSchema,
  browserOutreachMessageSchema as runtimeBrowserOutreachMessageSchema,
  browserReminderSchema as runtimeBrowserReminderSchema,
  browserSettingsSchema as runtimeBrowserSettingsSchema,
} from "./browserApplication.js";

export const browserApplicationDatabaseSchema =
  runtimeBrowserApplicationDatabaseSchema;
export const browserApplicationLifecycleStatusSchema =
  runtimeBrowserApplicationLifecycleStatusSchema;
export const browserApplicationSchema = runtimeBrowserApplicationSchema;
export const browserArtifactLinkSchema = runtimeBrowserArtifactLinkSchema;
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
export type BrowserArtifactLink = z.infer<typeof browserArtifactLinkSchema>;
export type BrowserReminder = z.infer<typeof browserReminderSchema>;
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
export type BrowserApplicationDatabase = z.infer<
  typeof browserApplicationDatabaseSchema
>;
