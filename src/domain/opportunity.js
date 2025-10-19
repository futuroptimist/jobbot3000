// Generated runtime companion for opportunity.ts
import { z } from 'zod';

export const lifecycleStateSchema = z.enum([
  'recruiter_outreach',
  'phone_screen_scheduled',
  'phone_screen_done',
  'onsite_scheduled',
  'offer_received',
  'offer_declined',
  'offer_accepted',
  'closed',
]);

export const opportunityEventTypeSchema = z.enum([
  'recruiter_outreach_received',
  'phone_screen_scheduled',
  'phone_screen_completed',
  'lifecycle_transition',
  'note_added',
]);

export const opportunityEventSchema = z.object({
  eventUid: z.string().min(1),
  opportunityUid: z.string().min(1),
  type: opportunityEventTypeSchema,
  occurredAt: z.string().datetime(),
  payload: z.record(z.any()).optional(),
});

export const opportunitySchema = z.object({
  uid: z.string().min(1),
  company: z.string().min(1),
  roleHint: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactName: z.string().optional(),
  lifecycleState: lifecycleStateSchema,
  firstSeenAt: z.string().datetime(),
  lastEventAt: z.string().datetime().optional(),
  subject: z.string().optional(),
  source: z.string().optional(),
});

export const recruiterEmailIngestInputSchema = z.object({
  raw: z.string().min(1, 'email content required'),
});
