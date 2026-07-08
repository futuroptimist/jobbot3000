const TERMINAL_EMPLOYER_STATUSES = new Set([
  "offer",
  "accepted",
  "rejected",
  "closed_archived",
]);
const RESPONSE_EVENT_TYPES = new Set([
  "hiring_manager_reply",
  "written_assessment_requested",
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
  "offer",
  "offer_received",
]);
const ASSESSMENT_EVENT_TYPES = new Set([
  "written_assessment",
  "written_assessment_requested",
  "written_assessment_submitted",
  "take_home",
  "take_home_requested",
  "take_home_submitted",
]);
const RECRUITER_SCREEN_EVENT_TYPES = new Set([
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
]);
const OUTREACH_REPLY_STATUSES = new Set(["replied", "reply", "responded"]);
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
const recruiterScreenKey = (record) =>
  [
    record.applicationId,
    record.dueAt ?? record.startsAt ?? record.occurredAt ?? record.id,
  ]
    .filter(Boolean)
    .join(":");

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
  let compactOutreachReplies = 0;
  const compactOutreachApplicationIds = new Set();
  const outboundOutreachApplicationIds = new Set();
  const recruiterScreenKeys = new Set();
  const assessmentApplicationIds = new Set();

  for (const application of applications) {
    const metadata = metadataByApplicationId.get(application.id) ?? {};
    const outreachStatus = compactOutreachStatus(metadata);
    if (outreachStatus) compactOutreachApplicationIds.add(application.id);
    if (OUTREACH_REPLY_STATUSES.has(outreachStatus)) {
      compactOutreachReplies += 1;
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
  let outreachReplies = compactOutreachReplies;
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
      addResponse(responseApplicationIds, message.applicationId);
    }
  }

  for (const applicationId of compactOutreachApplicationIds) {
    if (!outboundOutreachApplicationIds.has(applicationId)) outreachSent += 1;
  }

  for (const event of lifecycleEvents) {
    const eventType = normalize(event.eventType);
    const status = normalize(event.status);
    if (
      RESPONSE_EVENT_TYPES.has(eventType) ||
      TERMINAL_EMPLOYER_STATUSES.has(status)
    )
      addResponse(responseApplicationIds, event.applicationId);
    if (ASSESSMENT_EVENT_TYPES.has(eventType)) {
      addResponse(responseApplicationIds, event.applicationId);
      if (event.applicationId)
        assessmentApplicationIds.add(event.applicationId);
    }
    if (
      RECRUITER_SCREEN_EVENT_TYPES.has(eventType) ||
      status === "recruiter_screen"
    )
      recruiterScreenKeys.add(recruiterScreenKey(event));
  }

  for (const interview of interviews) {
    addResponse(responseApplicationIds, interview.applicationId);
    if (interview.stage === "recruiter_screen")
      recruiterScreenKeys.add(recruiterScreenKey(interview));
  }
  const nonRecruiterInterviews = interviews.filter(
    (interview) => interview.stage !== "recruiter_screen",
  );

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
    interviews: nonRecruiterInterviews.length,
    assessments: assessmentApplicationIds.size,
    offers: new Set([
      ...offers.map((offer) => offer.applicationId ?? offer.id).filter(Boolean),
      ...applications
        .filter(({ status }) => ["offer", "accepted"].includes(status))
        .map(({ id }) => id),
    ]).size,
  };
};
