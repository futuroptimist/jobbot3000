// Import-only ownership validation; canonical export deliberately keeps its existing schema.
const repairHint =
  "Choose a contact owned by this application or remove the optional reference. " +
  "Keep the original backup and preview a repaired copy. Nothing was imported.";
export const collectImportContactIssues = (
  candidate,
  { maxIssues = 50, locations = {} } = {},
) => {
  const limit = Math.max(
    0,
    Math.min(50, Number.isFinite(maxIssues) ? Math.trunc(maxIssues) : 50),
  );
  const issues = [];
  let truncated = false;
  const contacts = new Map();
  const duplicates = new Set();
  for (const contact of candidate.contacts ?? []) {
    if (contacts.has(contact.id)) duplicates.add(contact.id);
    contacts.set(contact.id, contact);
  }
  const check = (record, contactId, store, recordIndex, referenceIndex) => {
    if (contactId === undefined) return;
    const contact = contacts.get(contactId);
    if (
      !duplicates.has(contactId) &&
      contact?.applicationId === record.applicationId
    )
      return;
    if (issues.length >= limit) {
      truncated = true;
      return;
    }
    const location = locations[store]?.[recordIndex];
    issues.push({
      code: "import_ownership_failed",
      origin: location?.origin === "existing" ? "existing" : "incoming",
      store,
      recordIndex: location?.recordIndex ?? recordIndex,
      field: store === "interviews" ? "contactIds" : "contactId",
      ...(referenceIndex === undefined ? {} : { referenceIndex }),
      ...(location?.sourceLine === undefined
        ? {}
        : { sourceLine: location.sourceLine }),
      repairHint,
    });
  };
  for (const store of ["outreachMessages", "reminders", "interviews"]) {
    (candidate[store] ?? []).forEach((record, index) => {
      if (store === "interviews") {
        (record.contactIds ?? []).forEach((id, ref) =>
          check(record, id, store, index, ref),
        );
      } else check(record, record.contactId, store, index);
    });
  }
  return { issues, truncated };
};
