import type { Opportunity, OpportunityEvent } from "../domain/opportunity.js";
import type { AuditEntry, AuditLog } from "../services/audit.js";
import type { OpportunitiesRepo } from "../services/opportunitiesRepo.js";
import { ingestRecruiterEmail as runtimeIngestRecruiterEmail } from "./recruiterEmail.js";

export interface IngestRecruiterEmailArgs {
  raw: string;
  repo: OpportunitiesRepo;
  audit?: AuditLog;
}

export interface RecruiterEmailSchedule {
  iso: string;
  display: string;
  timezone: string;
}

export interface RecruiterEmailIngestResult {
  opportunity: Opportunity;
  events: OpportunityEvent[];
  auditEntries: AuditEntry[];
  schedule: RecruiterEmailSchedule | null;
}

export function ingestRecruiterEmail(
  args: IngestRecruiterEmailArgs,
): RecruiterEmailIngestResult {
  const result = runtimeIngestRecruiterEmail(args);
  return {
    opportunity: result.opportunity,
    events: result.events,
    auditEntries: result.auditEntries,
    schedule: result.schedule ?? null,
  };
}
