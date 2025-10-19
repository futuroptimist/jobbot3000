import type { z } from "zod";

import {
  AuditLog as AuditLogRuntime,
  auditEntrySchema as runtimeAuditEntrySchema,
} from "./audit.js";

export const auditEntrySchema = runtimeAuditEntrySchema;

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export interface AuditLogOptions {
  dataDir?: string;
  filename?: string;
  migrationsDir?: string;
}

export interface AuditAppendInput {
  eventUid?: string;
  relatedEventUid?: string;
  opportunityUid?: string;
  actor?: string;
  action: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

export interface AuditListOptions {
  opportunityUid?: string;
}

export class AuditLog {
  #audit: AuditLogRuntime;

  constructor(options: AuditLogOptions = {}) {
    this.#audit = new AuditLogRuntime(options);
  }

  append(entry: AuditAppendInput): AuditEntry | null {
    return this.#audit.append(entry);
  }

  getByEventUid(eventUid: string): AuditEntry | null {
    return this.#audit.getByEventUid(eventUid);
  }

  list(options: AuditListOptions = {}): AuditEntry[] {
    return this.#audit.list(options);
  }

  close(): void {
    this.#audit.close();
  }
}
