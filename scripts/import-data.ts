#!/usr/bin/env node

(async () => {
  const fs = await import("node:fs/promises");
  const pathModule = await import("node:path");
  const processModule = await import("node:process");
  const process = processModule.default ?? processModule;
  const { default: Database } = await import("better-sqlite3");
  const { z } = await import("zod");

  const resolvePath = pathModule.default?.resolve ?? pathModule.resolve;
  const joinPath = pathModule.default?.join ?? pathModule.join;

  function printUsage() {
    console.error(
      "Usage: node scripts/import-data.ts --source <file.ndjson> [--dry-run]",
    );
  }

  function getFlag(args, name) {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    return args[index + 1];
  }

  const args = process.argv.slice(2);
  const sourcePath = getFlag(args, "--source");
  const dryRun = args.includes("--dry-run");

  if (!sourcePath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const absoluteSource = resolvePath(sourcePath);
  const raw = await fs.readFile(absoluteSource, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const { opportunitySchema, opportunityEventSchema } = await import(
    "../src/domain/opportunity.js"
  );
  const { auditEntrySchema } = await import("../src/services/audit.js");
  const { OpportunitiesRepo } = await import(
    "../src/services/opportunitiesRepo.js"
  );
  const { AuditLog } = await import("../src/services/audit.js");

  const contactSchema = z.object({
    opportunity_uid: z.string().min(1),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  });

  const attachmentSchema = z.object({
    opportunity_uid: z.string().min(1),
    name: z.string().min(1),
    mime_type: z.string().optional(),
    uri: z.string().optional(),
  });

  const dataDir = process.env.JOBBOT_DATA_DIR || resolvePath("data");
  await fs.mkdir(dataDir, { recursive: true });
  const dbPath = joinPath(dataDir, "opportunities.db");

  const repo = new OpportunitiesRepo();
  const audit = new AuditLog();
  const db = new Database(dbPath);

  const contactInsert = db.prepare(
    "INSERT OR IGNORE INTO contacts (opportunity_uid, name, email, phone, created_at, updated_at) VALUES (@opportunity_uid, @name, @email, @phone, @created_at, @updated_at)",
  );
  const attachmentInsert = db.prepare(
    "INSERT OR IGNORE INTO attachments (opportunity_uid, name, mime_type, uri, created_at) VALUES (@opportunity_uid, @name, @mime_type, @uri, @created_at)",
  );

  let imported = 0;

  try {
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSON: ${line}\n${err}`);
      }

      const table = parsed?.table;
      const data = parsed?.data ?? {};
      switch (table) {
        case "opportunities": {
          const opportunity = opportunitySchema.parse({
            uid: data.uid,
            company: data.company,
            roleHint: data.role_hint ?? undefined,
            contactEmail: data.contact_email ?? undefined,
            contactName: data.contact_name ?? undefined,
            lifecycleState: data.lifecycle_state,
            firstSeenAt: data.first_seen_at,
            lastEventAt: data.last_event_at ?? undefined,
            subject: data.subject ?? undefined,
            source: data.source ?? undefined,
          });
          if (!dryRun) {
            repo.upsertOpportunity({
              company: opportunity.company,
              roleHint: opportunity.roleHint,
              contactEmail: opportunity.contactEmail,
              contactName: opportunity.contactName,
              lifecycleState: opportunity.lifecycleState,
              firstSeenAt: opportunity.firstSeenAt,
              lastEventAt: opportunity.lastEventAt,
              subject: opportunity.subject,
              source: opportunity.source,
            });
          }
          imported += 1;
          break;
        }
        case "events": {
          const event = opportunityEventSchema.parse({
            eventUid: data.event_uid,
            opportunityUid: data.opportunity_uid,
            type: data.type,
            occurredAt: data.occurred_at,
            payload: data.payload ? JSON.parse(data.payload) : undefined,
          });
          if (!dryRun) {
            repo.appendEvent({
              opportunityUid: event.opportunityUid,
              type: event.type,
              occurredAt: event.occurredAt,
              eventUid: event.eventUid,
              payload: event.payload,
            });
          }
          imported += 1;
          break;
        }
        case "audit_log": {
          const entry = auditEntrySchema.parse({
            eventUid: data.event_uid,
            opportunityUid: data.opportunity_uid ?? undefined,
            actor: data.actor ?? undefined,
            action: data.action,
            occurredAt: data.occurred_at,
            payload: data.payload ? JSON.parse(data.payload) : undefined,
            createdAt: data.created_at,
          });
          if (!dryRun) {
            audit.append({
              eventUid: entry.eventUid,
              opportunityUid: entry.opportunityUid,
              actor: entry.actor,
              action: entry.action,
              occurredAt: entry.occurredAt,
              payload: entry.payload,
            });
          }
          imported += 1;
          break;
        }
        case "contacts": {
          const contact = contactSchema.parse(data);
          if (!dryRun) {
            contactInsert.run({
              opportunity_uid: contact.opportunity_uid,
              name: contact.name ?? null,
              email: contact.email ?? null,
              phone: contact.phone ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          imported += 1;
          break;
        }
        case "attachments": {
          const attachment = attachmentSchema.parse(data);
          if (!dryRun) {
            attachmentInsert.run({
              opportunity_uid: attachment.opportunity_uid,
              name: attachment.name,
              mime_type: attachment.mime_type ?? null,
              uri: attachment.uri ?? null,
              created_at: new Date().toISOString(),
            });
          }
          imported += 1;
          break;
        }
        default:
          // ignore other tables like schema_version/about
          break;
      }
    }

    console.log(
      dryRun
        ? `Validated ${imported} rows (dry-run)`
        : `Imported ${imported} rows into opportunities database`,
    );
  } finally {
    try {
      repo.close();
    } catch {}
    try {
      audit.close();
    } catch {}
    db.close();
  }
})();
