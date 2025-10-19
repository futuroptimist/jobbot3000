#!/usr/bin/env node

(async () => {
  const { readFile } = await import("node:fs/promises");
  const pathModule = await import("node:path");
  const processModule = await import("node:process");
  const process = processModule.default ?? processModule;
  const resolvePath = pathModule.default?.resolve ?? pathModule.resolve;

  function printUsage() {
    console.error(
      "Usage: node bin/ingest-recruiter.ts --source <path-to-email.txt>",
    );
  }

  function getFlag(args, name) {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    return args[index + 1];
  }

  let repo;
  let audit;

  try {
    const args = process.argv.slice(2);
    const sourcePath = getFlag(args, "--source");
    if (!sourcePath) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const absoluteSource = resolvePath(sourcePath);
    const rawEmail = await readFile(absoluteSource, "utf8");

    const { OpportunitiesRepo } = await import(
      "../src/services/opportunitiesRepo.js"
    );
    const { AuditLog } = await import("../src/services/audit.js");
    const { ingestRecruiterEmail } = await import(
      "../src/ingest/recruiterEmail.js"
    );

    repo = new OpportunitiesRepo();
    audit = new AuditLog();

    const result = ingestRecruiterEmail({ raw: rawEmail, repo, audit });

    console.log(
      JSON.stringify(
        {
          opportunity: result.opportunity,
          events: result.events,
          auditEntries: result.auditEntries,
          schedule: result.schedule,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err?.stack || err);
    process.exitCode = 1;
  } finally {
    try {
      repo?.close();
    } catch {}
    try {
      audit?.close();
    } catch {}
  }
})();
