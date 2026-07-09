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
const interviewKey = (record) => {
  const classification = classifyLifecycleEventType(record.eventType);
  return [
    record.applicationId,
    record.startsAt ?? record.dueAt ?? record.occurredAt ?? record.id,
    record.stage ??
      classification.interviewStage ??
      record.eventType ??
      "interview",
  ]
    .filter(Boolean)
    .join(":");
};
const recruiterScreenKey = (record) =>
  [
    record.applicationId,
    record.dueAt ?? record.startsAt ?? record.occurredAt ?? record.id,
  ]
    .filter(Boolean)
    .join(":");
const isPlaceholderTimestamp = (value) =>
  value === "1970-01-01T00:00:00.000Z" || value === "1970-01-01";
const hasLifecycleInterviewTime = (event, classification) => {
  if (event.startsAt || event.dueAt) return true;
  if (!event.occurredAt || isPlaceholderTimestamp(event.occurredAt))
    return false;
  return classification.interviewOutcome === "completed";
};

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
  const explicitNonRecruiterInterviewKeys = new Set();

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
      recruiterScreenKeys.add(recruiterScreenKey(event));
    if (
      isLifecycleNonRecruiterInterview(eventType) &&
      hasLifecycleInterviewTime(event, classification)
    )
      lifecycleNonRecruiterInterviewKeys.add(interviewKey(event));
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
      const lifecycleDuplicateKey = interviewKey(interview);
      if (!lifecycleNonRecruiterInterviewKeys.has(lifecycleDuplicateKey))
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
