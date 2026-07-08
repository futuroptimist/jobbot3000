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
]);
const ASSESSMENT_EVENT_TYPES = new Set([
  "written_assessment_requested",
  "written_assessment_submitted",
  "take_home_requested",
  "take_home_submitted",
]);
const RECRUITER_SCREEN_EVENT_TYPES = new Set([
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
]);
const NON_RESPONSE_EVENT_TYPES = new Set([
  "application_submitted",
  "next_tracking_step",
  "local_follow_up_reminder",
  "note",
]);

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clampPercent = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round(value));
};

export const formatMetricPercent = (numerator, denominator) =>
  `${clampPercent(denominator > 0 ? (numerator / denominator) * 100 : 0)}%`;

const parseSpreadsheetMetadata = (notes) => {
  const line = String(notes ?? "")
    .split("\n")
    .find((entry) => entry.startsWith("Spreadsheet metadata:"));
  if (!line) return {};
  try {
    return JSON.parse(line.slice("Spreadsheet metadata:".length).trim());
  } catch {
    return {};
  }
};

const isAssessmentLabel = (value) => {
  const label = normalize(value);
  return label.includes("written_assessment") || label.includes("take_home");
};

const hasCompactReply = (application) =>
  normalize(parseSpreadsheetMetadata(application.notes).outreach_status) ===
  "replied";

const hasCompactAssessment = (application) =>
  isAssessmentLabel(
    parseSpreadsheetMetadata(application.notes).spreadsheet_interview_stage,
  );

const isInboundReply = (message) =>
  message.direction === "inbound" || normalize(message.status) === "replied";

const isResponseEvent = (event) => {
  const eventType = normalize(event.eventType);
  if (NON_RESPONSE_EVENT_TYPES.has(eventType)) return false;
  return RESPONSE_EVENT_TYPES.has(eventType);
};

const isAssessmentEvent = (event) =>
  ASSESSMENT_EVENT_TYPES.has(normalize(event.eventType));
const isRecruiterScreenEvent = (event) =>
  RECRUITER_SCREEN_EVENT_TYPES.has(normalize(event.eventType));

/**
 * Computes dashboard metrics from the browser tracker bundle without DOM access.
 * Application response rate is unique applications with employer responses divided
 * by total applications. Outreach reply rate is inbound/replied outreach messages
 * divided by outbound outreach messages. Both percentages are clamped to 0–100%.
 */
export const computeDashboardMetrics = (bundle = {}) => {
  const applications = bundle.applications ?? [];
  const outreachMessages = bundle.outreachMessages ?? [];
  const lifecycleEvents = bundle.lifecycleEvents ?? [];
  const interviews = bundle.interviews ?? [];
  const offers = bundle.offers ?? [];

  const applicationIdsWithResponse = new Set();
  for (const app of applications) {
    if (
      TERMINAL_EMPLOYER_STATUSES.has(app.status) ||
      hasCompactReply(app) ||
      hasCompactAssessment(app)
    )
      applicationIdsWithResponse.add(app.id);
  }
  for (const message of outreachMessages) {
    if (isInboundReply(message))
      applicationIdsWithResponse.add(message.applicationId);
  }
  for (const event of lifecycleEvents) {
    if (isResponseEvent(event))
      applicationIdsWithResponse.add(event.applicationId);
  }
  for (const offer of offers)
    applicationIdsWithResponse.add(offer.applicationId);

  const totalApplications = applications.length;
  const outreachSent = outreachMessages.filter(
    ({ direction }) => direction === "outbound",
  ).length;
  const outreachReplies = outreachMessages.filter(isInboundReply).length;
  const recruiterScreenApplications = new Set([
    ...interviews
      .filter(({ stage }) => stage === "recruiter_screen")
      .map(({ applicationId }) => applicationId),
    ...lifecycleEvents
      .filter(isRecruiterScreenEvent)
      .map(({ applicationId }) => applicationId),
  ]);
  const recruiterScreens = recruiterScreenApplications.size;
  const interviewsCount = interviews.filter(
    ({ stage }) => stage !== "recruiter_screen",
  ).length;
  const assessments =
    applications.filter(hasCompactAssessment).length +
    lifecycleEvents.filter(isAssessmentEvent).length;
  const offersCount =
    offers.length +
    applications.filter(({ status }) => ["offer", "accepted"].includes(status))
      .length;
  const applicationsWithResponse = Math.min(
    applicationIdsWithResponse.size,
    totalApplications,
  );

  return {
    totalApplications,
    outreachSent,
    outreachReplies,
    applicationsWithResponse,
    applicationResponseRate: formatMetricPercent(
      applicationsWithResponse,
      totalApplications,
    ),
    outreachReplyRate: formatMetricPercent(outreachReplies, outreachSent),
    recruiterScreens,
    interviews: interviewsCount,
    assessments,
    offers: offersCount,
    applicationResponseLabel: `${applicationsWithResponse} of ${totalApplications} applications`,
    outreachReplyLabel: `${outreachReplies} of ${outreachSent} outreach messages`,
  };
};
