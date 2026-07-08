const TERMINAL_EMPLOYER_OUTCOME_STATUSES = new Set([
  "offer",
  "accepted",
  "rejected",
  "closed_archived",
]);
const RESPONSE_LIFECYCLE_EVENT_TYPES = new Set([
  "hiring_manager_reply",
  "written_assessment_requested",
  "recruiter_screen_scheduled",
  "offer",
]);
const ASSESSMENT_EVENT_TYPES = new Set([
  "written_assessment_requested",
  "written_assessment_submitted",
  "take_home_requested",
  "take_home_submitted",
]);
const ASSESSMENT_LABEL_PATTERN =
  /\b(?:written[_\s-]*assessment|take[_\s-]*home)\b/i;
const CSV_METADATA_PREFIX = "Spreadsheet metadata:";

const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clampCount = (value) => Math.max(0, Number.isFinite(value) ? value : 0);

export const formatMetricPercent = (numerator, denominator) => {
  const safeNumerator = clampCount(numerator);
  const safeDenominator = clampCount(denominator);
  if (safeDenominator === 0) return "0%";
  const percent = Math.round((safeNumerator / safeDenominator) * 100);
  return `${Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0))}%`;
};

const readSpreadsheetMetadata = (notes) => {
  const metadataLine = String(notes ?? "")
    .split("\n")
    .find((line) => line.startsWith(CSV_METADATA_PREFIX));
  if (!metadataLine) return {};
  try {
    return JSON.parse(metadataLine.slice(CSV_METADATA_PREFIX.length).trim());
  } catch {
    return {};
  }
};

const applicationHasResponseSignal = (application, scoped) => {
  const metadata = readSpreadsheetMetadata(application.notes);
  if (normalizeKey(metadata.outreach_status) === "replied") return true;
  if (TERMINAL_EMPLOYER_OUTCOME_STATUSES.has(normalizeKey(application.status)))
    return true;
  if (ASSESSMENT_LABEL_PATTERN.test(metadata.spreadsheet_interview_stage))
    return true;
  if (
    scoped.outreachMessages.some(
      (message) =>
        message.direction === "inbound" ||
        normalizeKey(message.direction) === "replied",
    )
  )
    return true;
  if (
    scoped.lifecycleEvents.some((event) =>
      RESPONSE_LIFECYCLE_EVENT_TYPES.has(normalizeKey(event.eventType)),
    )
  )
    return true;
  return scoped.offers.length > 0;
};

/**
 * Computes dashboard metrics from the browser IndexedDB export bundle.
 * Application response rate is intentionally application-level: one application
 * with many child reply/assessment/screen/offer records contributes one
 * applicationsWithResponse numerator. Outreach reply rate is message-level.
 */
export const computeTrackerMetrics = (bundle = {}) => {
  const applications = asArray(bundle.applications);
  const outreachMessages = asArray(bundle.outreachMessages);
  const lifecycleEvents = asArray(bundle.lifecycleEvents);
  const interviews = asArray(bundle.interviews);
  const offers = asArray(bundle.offers);
  const byApplication = new Map(
    applications.map((application) => [
      application.id,
      { outreachMessages: [], lifecycleEvents: [], interviews: [], offers: [] },
    ]),
  );
  const scope = (record, store) => {
    const scoped = byApplication.get(record.applicationId);
    if (scoped) scoped[store].push(record);
  };
  outreachMessages.forEach((record) => scope(record, "outreachMessages"));
  lifecycleEvents.forEach((record) => scope(record, "lifecycleEvents"));
  interviews.forEach((record) => scope(record, "interviews"));
  offers.forEach((record) => scope(record, "offers"));

  const responseApplicationIds = new Set(
    applications
      .filter((application) =>
        applicationHasResponseSignal(
          application,
          byApplication.get(application.id),
        ),
      )
      .map(({ id }) => id),
  );
  const compactOutreachReplies = applications.filter(
    (application) =>
      normalizeKey(
        readSpreadsheetMetadata(application.notes).outreach_status,
      ) === "replied",
  ).length;
  const outreachSent = outreachMessages.filter(
    ({ direction }) => direction === "outbound",
  ).length;
  const outreachReplies =
    compactOutreachReplies +
    outreachMessages.filter(
      ({ direction }) => direction === "inbound" || direction === "replied",
    ).length +
    lifecycleEvents.filter(
      ({ eventType }) => normalizeKey(eventType) === "hiring_manager_reply",
    ).length;
  const recruiterScreenKeys = new Set();
  interviews
    .filter(({ stage }) => stage === "recruiter_screen")
    .forEach(({ applicationId, startsAt }) =>
      recruiterScreenKeys.add(`${applicationId}:${startsAt ?? "scheduled"}`),
    );
  lifecycleEvents
    .filter(
      ({ eventType }) =>
        normalizeKey(eventType) === "recruiter_screen_scheduled",
    )
    .forEach(({ applicationId, dueAt, occurredAt }) =>
      recruiterScreenKeys.add(
        `${applicationId}:${dueAt ?? occurredAt ?? "scheduled"}`,
      ),
    );
  const recruiterScreens = recruiterScreenKeys.size;
  const assessments = lifecycleEvents.filter(({ eventType, stageLabel }) => {
    const normalizedType = normalizeKey(eventType);
    return (
      ASSESSMENT_EVENT_TYPES.has(normalizedType) ||
      ASSESSMENT_LABEL_PATTERN.test(stageLabel)
    );
  }).length;
  const offerCount =
    offers.length +
    applications.filter(({ status }) => ["offer", "accepted"].includes(status))
      .length;

  return {
    totalApplications: applications.length,
    outreachSent,
    outreachReplies,
    applicationsWithResponse: responseApplicationIds.size,
    applicationResponseRate: formatMetricPercent(
      responseApplicationIds.size,
      applications.length,
    ),
    outreachReplyRate: formatMetricPercent(outreachReplies, outreachSent),
    recruiterScreens,
    interviews: interviews.filter(({ stage }) => stage !== "recruiter_screen")
      .length,
    assessments,
    offers: offerCount,
  };
};
