import { z } from "zod";

import {
  lifecycleStateSchema as runtimeLifecycleStateSchema,
  opportunityEventSchema as runtimeOpportunityEventSchema,
  opportunityEventTypeSchema as runtimeOpportunityEventTypeSchema,
  opportunitySchema as runtimeOpportunitySchema,
  recruiterEmailIngestInputSchema as runtimeRecruiterEmailIngestInputSchema,
} from "./opportunity.js";

export const lifecycleStateSchema = runtimeLifecycleStateSchema;
export const opportunityEventSchema = runtimeOpportunityEventSchema;
export const opportunityEventTypeSchema = runtimeOpportunityEventTypeSchema;
export const opportunitySchema = runtimeOpportunitySchema;
export const recruiterEmailIngestInputSchema =
  runtimeRecruiterEmailIngestInputSchema;

export type LifecycleState = z.infer<typeof lifecycleStateSchema>;
export type OpportunityEvent = z.infer<typeof opportunityEventSchema>;
export type OpportunityEventType = z.infer<typeof opportunityEventTypeSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type RecruiterEmailIngestInput = z.infer<
  typeof recruiterEmailIngestInputSchema
>;
