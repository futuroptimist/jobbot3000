import {
  classifyLifecycleEventType,
  isLifecycleAssessment,
  isLifecycleNonRecruiterInterview,
  isLifecycleRecruiterScreen,
} from "./lifecycleClassification.js";
const TERMINAL_EMPLOYER_STATUSES = new Set([
  "offer",
  "accepted",
  "rejected",
  "closed_archived",
]);
const OFFER_EVENT_TYPES = new Set(["offer", "offer_received"]);
const OUTREACH_REPLY_STATUSES = new Set(["replied", "reply", "responded"]);
const OUTREACH_SENT_STATUSES = new Set(["sent", ...OUTREACH_REPLY_STATUSES]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const readSpreadsheetMetadata = (notes) => {
  const prefix = "Spreadsheet metadata:";
  const line = String(notes ?? "")
    .split("\n")
    .find((item) => item.startsWith(prefix));
  if (!line) return {};
  try {
    return JSON.parse(line.slice(prefix.length).trim());
  } catch {
    return {};
  }
};

export const boundedPercentage = (numerator, denominator) => {
  if (denominator <= 0 || numerator <= 0) return 0;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  return clamp(Math.round((numerator / denominator) * 100), 0, 100);
};

const applicationMetadata = (bundle) =>
  new Map(
    (bundle.applications ?? []).map((application) => [
      application.id,
      readSpreadsheetMetadata(application.notes),
    ]),
  );

const compactStage = (metadata) =>
  normalize(metadata.spreadsheet_interview_stage);
const compactOutcome = (metadata) => normalize(metadata.spreadsheet_outcome);
const compactOutreachStatus = (metadata) => normalize(metadata.outreach_status);

const isAssessmentMetadata = (metadata) => {
  const stage = compactStage(metadata);
  const outcome = compactOutcome(metadata);
  return (
    stage.includes("written_assessment") ||
    outcome.includes("written_assessment") ||
    stage.includes("take_home") ||
    outcome.includes("take_home")
  );
};

const addResponse = (responses, applicationId) => {
  if (applicationId) responses.add(applicationId);
};
const canonicalTimestamp = (value) => {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
};
const isAmbiguousLegacyDateOnlyTimestamp = (value) => {
  if (!value) return false;
  const canonical = canonicalTimestamp(value);
  return Boolean(canonical?.match(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/));
};
const lifecycleTimestampHasTime = (event, field, value) => {
  const flag = event[`${field}HasTime`];
  if (typeof flag === "boolean") return flag;
  if (!value) return false;
  if (
    event.source === "csv_import" &&
    isAmbiguousLegacyDateOnlyTimestamp(value)
  )
    return false;
  return true;
};
const isTimedLifecycleInterviewTimestamp = (event, field, value) =>
  Boolean(value) &&
  !isPlaceholderTimestamp(value) &&
  lifecycleTimestampHasTime(event, field, value);
const timedValue = (event, ...fieldValuePairs) =>
  fieldValuePairs.find(([field, value]) =>
    isTimedLifecycleInterviewTimestamp(event, field, value),
  )?.[1];
const lifecycleInterviewTimestamp = (event, classification) => {
  if (classification.interviewOutcome === "completed")
    return timedValue(
      event,
      ["occurredAt", event.occurredAt],
      ["dueAt", event.dueAt],
      ["startsAt", event.startsAt],
    );
  return timedValue(
    event,
    ["dueAt", event.dueAt],
    ["startsAt", event.startsAt],
  );
};
const matchingExplicitCompletedTimestamp = (
  event,
  classification,
  explicitInterviewKeys,
) => {
  if (
    classification.interviewOutcome !== "completed" ||
    typeof event.occurredAtHasTime === "boolean" ||
    !event.occurredAt
  )
    return undefined;
  const key = interviewKey(event, event.occurredAt);
  return explicitInterviewKeys.has(key) ? event.occurredAt : undefined;
};
const interviewKey = (record, timestamp) => {
  const classification = classifyLifecycleEventType(record.eventType);
  return [
    record.applicationId,
    canonicalTimestamp(
      timestamp ?? record.startsAt ?? record.dueAt ?? record.occurredAt,
    ),
    record.stage ??
      classification.interviewStage ??
      record.eventType ??
      "interview",
  ]
    .filter(Boolean)
    .join(":");
};
const recruiterScreenIdentityKey = (record = {}, timestamp) =>
  [record.applicationId, canonicalTimestamp(timestamp) ?? record.id]
    .filter(Boolean)
    .join(":");
const matchingExplicitCompletedRecruiterScreenTimestamp = (
  record,
  explicitRecruiterScreenKeys = new Set(),
) => {
  if (
    typeof record.occurredAtHasTime === "boolean" ||
    !record.occurredAt ||
    !explicitRecruiterScreenKeys.size
  )
    return undefined;
  const key = recruiterScreenIdentityKey(record, record.occurredAt);
  return explicitRecruiterScreenKeys.has(key) ? record.occurredAt : undefined;
};
export const recruiterScreenTimestamp = (
  record = {},
  explicitRecruiterScreenKeys = new Set(),
) => {
  if (record.startsAt) return record.startsAt;
  const classification = classifyLifecycleEventType(record.eventType);
  if (classification.interviewOutcome === "completed")
    return (
      matchingExplicitCompletedRecruiterScreenTimestamp(
        record,
        explicitRecruiterScreenKeys,
      ) ??
      timedValue(record, ["occurredAt", record.occurredAt]) ??
      timedValue(record, ["dueAt", record.dueAt])
    );
  if (classification.interviewOutcome === "scheduled")
    return timedValue(record, ["dueAt", record.dueAt]);
  return (
    timedValue(record, ["dueAt", record.dueAt]) ??
    timedValue(record, ["occurredAt", record.occurredAt])
  );
};
export const recruiterScreenKey = (
  record = {},
  explicitRecruiterScreenKeys = new Set(),
) =>
  recruiterScreenIdentityKey(
    record,
    recruiterScreenTimestamp(record, explicitRecruiterScreenKeys),
  );
const isPlaceholderTimestamp = (value) =>
  value === "1970-01-01T00:00:00.000Z" || value === "1970-01-01";
const uniqueUsableTimestamps = (candidates) => [
  ...new Set(
    candidates.filter(
      (candidate) => candidate && !isPlaceholderTimestamp(candidate),
    ),
  ),
];
const lifecycleInterviewTimestampCandidates = (
  event,
  classification,
  explicitInterviewKeys = new Set(),
) => {
  const candidates = [
    matchingExplicitCompletedTimestamp(
      event,
      classification,
      explicitInterviewKeys,
    ) ?? lifecycleInterviewTimestamp(event, classification),
  ];
  if (classification.interviewOutcome === "completed") {
    candidates.push(
      timedValue(event, ["dueAt", event.dueAt]),
      timedValue(event, ["startsAt", event.startsAt]),
      timedValue(event, ["occurredAt", event.occurredAt]),
    );
  }
  return uniqueUsableTimestamps(candidates);
};
const lifecycleInterviewDuplicateTimestampCandidates = (
  event,
  classification,
  explicitInterviewKeys = new Set(),
) => {
  const timestamp =
    matchingExplicitCompletedTimestamp(
      event,
      classification,
      explicitInterviewKeys,
    ) ?? lifecycleInterviewTimestamp(event, classification);
  return uniqueUsableTimestamps([timestamp]);
};
const lifecycleInterviewKey = (
  event,
  classification,
  explicitInterviewKeys,
) => {
  const [timestamp] = lifecycleInterviewTimestampCandidates(
    event,
    classification,
    explicitInterviewKeys,
  );
  if (!timestamp) return undefined;
  return interviewKey(event, timestamp);
};
const lifecycleInterviewDuplicateKeys = (
  event,
  classification,
  explicitInterviewKeys,
) =>
  lifecycleInterviewDuplicateTimestampCandidates(
    event,
    classification,
    explicitInterviewKeys,
  ).map((timestamp) => interviewKey(event, timestamp));

/**
 * Dashboard selector for imported tracker bundles.
 * - applicationResponseRate is unique responding applications / total applications.
 * - outreachReplyRate is inbound/replied outreach messages / outbound outreach messages.
 * - recruiterScreens, interviews, and assessments are intentionally split so
 *   assessment and hiring-manager-reply child records cannot inflate interviews.
 */
export const selectDashboardMetrics = (bundle = {}) => {
  const applications = bundle.applications ?? [];
  const outreachMessages = bundle.outreachMessages ?? [];
  const lifecycleEvents = bundle.lifecycleEvents ?? [];
  const interviews = bundle.interviews ?? [];
  const offers = bundle.offers ?? [];
  const metadataByApplicationId = applicationMetadata(bundle);
  const responseApplicationIds = new Set();
  const compactOutreachReplyApplicationIds = new Set();
  const compactOutreachApplicationIds = new Set();
  const outboundOutreachApplicationIds = new Set();
  const recruiterScreenKeys = new Set();
  const assessmentApplicationIds = new Set();
  const offerApplicationIds = new Set();
  const lifecycleNonRecruiterInterviewKeys = new Set();
  const lifecycleNonRecruiterInterviewDuplicateKeys = new Set();
  const explicitNonRecruiterInterviewKeys = new Set();
  const explicitNonRecruiterInterviewCanonicalKeys = new Set(
    interviews
      .filter(({ stage }) => stage !== "recruiter_screen")
      .map((interview) => interviewKey(interview, interview.startsAt)),
  );
  const explicitRecruiterScreenKeys = new Set(
    interviews
      .filter(({ stage }) => stage === "recruiter_screen")
      .map((interview) => recruiterScreenKey(interview)),
  );

  for (const application of applications) {
    const metadata = metadataByApplicationId.get(application.id) ?? {};
    const outreachStatus = compactOutreachStatus(metadata);
    if (OUTREACH_SENT_STATUSES.has(outreachStatus))
      compactOutreachApplicationIds.add(application.id);
    if (OUTREACH_REPLY_STATUSES.has(outreachStatus)) {
      compactOutreachReplyApplicationIds.add(application.id);
      addResponse(responseApplicationIds, application.id);
    }
    if (TERMINAL_EMPLOYER_STATUSES.has(application.status))
      addResponse(responseApplicationIds, application.id);
    if (isAssessmentMetadata(metadata)) {
      addResponse(responseApplicationIds, application.id);
      assessmentApplicationIds.add(application.id);
    }
  }

  let outreachSent = 0;
  let outreachReplies = 0;
  const representedReplyApplicationIds = new Set();
  const lifecycleReplyApplicationIds = new Set();
  for (const message of outreachMessages) {
    const direction = normalize(message.direction);
    if (direction === "outbound") {
      outreachSent += 1;
      if (message.applicationId)
        outboundOutreachApplicationIds.add(message.applicationId);
    }
    if (
      direction === "inbound" ||
      OUTREACH_REPLY_STATUSES.has(normalize(message.status))
    ) {
      outreachReplies += 1;
      if (message.applicationId)
        representedReplyApplicationIds.add(message.applicationId);
      addResponse(responseApplicationIds, message.applicationId);
    }
  }

  for (const applicationId of compactOutreachReplyApplicationIds) {
    if (!representedReplyApplicationIds.has(applicationId))
      outreachReplies += 1;
  }

  for (const applicationId of compactOutreachApplicationIds) {
    if (!outboundOutreachApplicationIds.has(applicationId)) outreachSent += 1;
  }

  for (const event of lifecycleEvents) {
    const eventType = normalize(event.eventType);
    const status = normalize(event.status);
    const classification = classifyLifecycleEventType(eventType);
    if (
      classification.countsAsResponse ||
      OFFER_EVENT_TYPES.has(eventType) ||
      TERMINAL_EMPLOYER_STATUSES.has(status)
    )
      addResponse(responseApplicationIds, event.applicationId);
    if (eventType === "hiring_manager_reply" && event.applicationId)
      lifecycleReplyApplicationIds.add(event.applicationId);
    if (isLifecycleAssessment(eventType)) {
      addResponse(responseApplicationIds, event.applicationId);
      if (event.applicationId)
        assessmentApplicationIds.add(event.applicationId);
    }
    if (isLifecycleRecruiterScreen(eventType) || status === "recruiter_screen")
      recruiterScreenKeys.add(
        recruiterScreenKey(event, explicitRecruiterScreenKeys),
      );
    if (isLifecycleNonRecruiterInterview(eventType)) {
      const key = lifecycleInterviewKey(
        event,
        classification,
        explicitNonRecruiterInterviewCanonicalKeys,
      );
      if (key) {
        lifecycleNonRecruiterInterviewKeys.add(key);
        for (const duplicateKey of lifecycleInterviewDuplicateKeys(
          event,
          classification,
          explicitNonRecruiterInterviewCanonicalKeys,
        ))
          lifecycleNonRecruiterInterviewDuplicateKeys.add(duplicateKey);
      }
    }
    if (
      OFFER_EVENT_TYPES.has(eventType) ||
      ["offer", "accepted"].includes(status)
    )
      offerApplicationIds.add(event.applicationId);
  }

  for (const applicationId of lifecycleReplyApplicationIds) {
    if (
      !representedReplyApplicationIds.has(applicationId) &&
      !compactOutreachReplyApplicationIds.has(applicationId)
    )
      outreachReplies += 1;
  }

  for (const interview of interviews) {
    addResponse(responseApplicationIds, interview.applicationId);
    if (interview.stage === "recruiter_screen")
      recruiterScreenKeys.add(recruiterScreenKey(interview));
  }
  for (const interview of interviews) {
    if (interview.stage !== "recruiter_screen") {
      const lifecycleDuplicateKey = interviewKey(interview, interview.startsAt);
      if (
        !lifecycleNonRecruiterInterviewDuplicateKeys.has(lifecycleDuplicateKey)
      )
        explicitNonRecruiterInterviewKeys.add(
          interview.id ? `explicit:${interview.id}` : lifecycleDuplicateKey,
        );
    }
  }

  return {
    totalApplications: applications.length,
    outreachSent,
    outreachReplies,
    applicationsWithResponse: responseApplicationIds.size,
    applicationResponseRate: boundedPercentage(
      responseApplicationIds.size,
      applications.length,
    ),
    outreachReplyRate: boundedPercentage(outreachReplies, outreachSent),
    recruiterScreens: recruiterScreenKeys.size,
    interviews:
      lifecycleNonRecruiterInterviewKeys.size +
      explicitNonRecruiterInterviewKeys.size,
    assessments: assessmentApplicationIds.size,
    offers: new Set(
      [
        ...offers
          .map((offer) => offer.applicationId ?? offer.id)
          .filter(Boolean),
        ...applications
          .filter(({ status }) => ["offer", "accepted"].includes(status))
          .map(({ id }) => id),
        ...offerApplicationIds,
      ].filter(Boolean),
    ).size,
  };
};
