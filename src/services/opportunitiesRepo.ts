import type {
  LifecycleState,
  Opportunity,
  OpportunityEvent,
  OpportunityEventType,
} from "../domain/opportunity.js";
import {
  OpportunitiesRepo as OpportunitiesRepoRuntime,
  computeOpportunityUid as computeOpportunityUidRuntime,
} from "./opportunitiesRepo.js";

export interface OpportunitiesRepoOptions {
  dataDir?: string;
  filename?: string;
  migrationsDir?: string;
}

export interface UpsertOpportunityInput {
  company: string;
  roleHint?: string;
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  lifecycleState: LifecycleState;
  firstSeenAt?: string;
  lastEventAt?: string;
  subject?: string;
  source?: string;
}

export interface AppendEventInput {
  opportunityUid: string;
  type: OpportunityEventType | (string & {});
  occurredAt?: string;
  eventUid?: string;
  payload?: Record<string, unknown> | undefined;
  lifecycleState?: LifecycleState;
}

export class OpportunitiesRepo {
  #repo: OpportunitiesRepoRuntime;

  constructor(options: OpportunitiesRepoOptions = {}) {
    this.#repo = new OpportunitiesRepoRuntime(options);
  }

  upsertOpportunity(input: UpsertOpportunityInput): Opportunity | null {
    return this.#repo.upsertOpportunity(input);
  }

  getOpportunityByUid(uid: string): Opportunity | null {
    return this.#repo.getOpportunityByUid(uid);
  }

  listOpportunities(): Opportunity[] {
    return this.#repo.listOpportunities();
  }

  appendEvent(input: AppendEventInput): OpportunityEvent | null {
    return this.#repo.appendEvent(input);
  }

  getEventByUid(eventUid: string): OpportunityEvent | null {
    return this.#repo.getEventByUid(eventUid);
  }

  listEvents(opportunityUid: string): OpportunityEvent[] {
    return this.#repo.listEvents(opportunityUid);
  }

  clearAll(): void {
    this.#repo.clearAll();
  }

  close(): void {
    this.#repo.close();
  }
}

export const computeOpportunityUid = computeOpportunityUidRuntime;
