import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ingestRecruiterEmail } from "../src/ingest/recruiterEmail.js";
import { AuditLog } from "../src/services/audit.js";
import { OpportunitiesRepo } from "../src/services/opportunitiesRepo.js";

const SAMPLE_EMAIL = `From: Casey Recruiter <casey@instabase.com>
To: Candidate <you@example.com>
Subject: Instabase recruiter outreach - Phone screen for Solutions Engineer
Date: Wed, 22 Oct 2025 10:00:00 -0700

Hi Alex,

Thanks for your interest in Instabase! We'd love to connect.
Would you be available for a phone screen on Thu Oct 23, 2:00 PM PT?

Best,
Casey
Instabase Recruiting`;

describe("recruiter email ingestion", () => {
  let tempDir: string;
  let previousDataDir: string | undefined;
  let repo: OpportunitiesRepo;
  let audit: AuditLog;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "jobbot-recruiter-ingest-"),
    );
    previousDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = tempDir;
    repo = new OpportunitiesRepo();
    audit = new AuditLog();
  });

  afterEach(async () => {
    repo.close();
    audit.close();
    if (previousDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = previousDataDir;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("ingests recruiter outreach idempotently", () => {
    const first = ingestRecruiterEmail({ raw: SAMPLE_EMAIL, repo, audit });
    const second = ingestRecruiterEmail({ raw: SAMPLE_EMAIL, repo, audit });

    expect(first.opportunity.uid).toBe(second.opportunity.uid);
    expect(first.opportunity.lifecycleState).toBe("phone_screen_scheduled");
    expect(second.opportunity.lifecycleState).toBe("phone_screen_scheduled");

    const opportunities = repo.listOpportunities();
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].lifecycleState).toBe("phone_screen_scheduled");

    const events = repo.listEvents(first.opportunity.uid);
    expect(events).toHaveLength(3);
    const uniqueEventUids = new Set(events.map((event) => event.eventUid));
    expect(uniqueEventUids.size).toBe(3);

    const audits = audit.list({ opportunityUid: first.opportunity.uid });
    expect(audits.length).toBeGreaterThanOrEqual(3);
  });
});
