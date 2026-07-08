const EMPTY_ARRAY = Object.freeze([]);
const TERMINAL_RESPONSE_STATUSES = new Set([
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);
const ASSESSMENT_EVENT_TYPES = new Set([
  "written_assessment_requested",
  "written_assessment_submitted",
  "take_home_requested",
  "take_home_submitted",
]);
const EMPLOYER_RESPONSE_EVENT_TYPES = new Set([
  "hiring_manager_reply",
  "written_assessment_requested",
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
  "offer_received",
]);
const RECRUITER_SCREEN_EVENT_TYPES = new Set([
  "recruiter_screen_scheduled",
  "recruiter_screen_completed",
]);
const LOCAL_ONLY_EVENT_TYPES = new Set([
  "application_submitted",
  "next_tracking_step",
  "follow_up_reminder",
  "note",
  "user_note",
]);
const CSV_METADATA_PREFIX = "Spreadsheet metadata:";

const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const normalizeLabelKey = (value) =>
  normalizeKey(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const arrays = (bundle = {}) => ({
  applications: bundle.applications ?? EMPTY_ARRAY,
  outreachMessages: bundle.outreachMessages ?? EMPTY_ARRAY,
  lifecycleEvents: bundle.lifecycleEvents ?? EMPTY_ARRAY,
  interviews: bundle.interviews ?? EMPTY_ARRAY,
  offers: bundle.offers ?? EMPTY_ARRAY,
});
const percent = (numerator, denominator) => {
  if (!denominator || denominator < 0) return 0;
  const value = Math.round((Math.max(0, numerator) / denominator) * 100);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

export const formatMetricPercent = (value) =>
  `${Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))}%`;

const metadataFromNotes = (notes) => {
  const line = String(notes ?? "")
    .split("\n")
    .find((entry) => entry.startsWith(CSV_METADATA_PREFIX));
  if (!line) return {};
  try {
    return JSON.parse(line.slice(CSV_METADATA_PREFIX.length).trim());
  } catch {
    return {};
  }
};
const isAssessmentLabel = (value) => {
  const key = normalizeLabelKey(value);
  return (
    key === "written_assessment" ||
    key.startsWith("written_assessment_") ||
    key === "take_home" ||
    key.startsWith("take_home_")
  );
};
const isEmployerLifecycleResponse = (event) => {
  const eventType = normalizeLabelKey(event.eventType);
  if (LOCAL_ONLY_EVENT_TYPES.has(eventType)) return false;
  return (
    EMPLOYER_RESPONSE_EVENT_TYPES.has(eventType) ||
    TERMINAL_RESPONSE_STATUSES.has(event.status) ||
    isAssessmentLabel(event.stageLabel)
  );
};
const add = (set, id) => {
  if (id) set.add(id);
};

/**
 * Dashboard metric definitions:
 * - Application response rate is unique applications with employer responses
 *   or terminal outcomes / total applications.
 * - Outreach reply rate is reply signals / outbound outreach messages.
 * - Recruiter screens, non-recruiter interviews, assessments, and offers are distinct concepts.
 * Percentages are rounded and guarded so impossible values never render above
 * 100%, negative, NaN%, or Infinity%.
 */
export const selectDashboardMetrics = (bundle = {}) => {
  const {
    applications,
    outreachMessages,
    lifecycleEvents,
    interviews,
    offers,
  } = arrays(bundle);
  const applicationsWithResponse = new Set();
  const assessmentApplications = new Set();
  const recruiterScreenApplications = new Set();
  const interviewApplications = new Set();
  const offerApplications = new Set();

  const outreachSent = outreachMessages.filter(
    ({ direction }) => direction !== "inbound",
  ).length;
  let outreachReplies = outreachMessages.filter(
    ({ direction }) => direction === "inbound",
  ).length;

  for (const app of applications) {
    const metadata = metadataFromNotes(app.notes);
    if (normalizeLabelKey(metadata.outreach_status) === "replied") {
      add(applicationsWithResponse, app.id);
      outreachReplies += 1;
    }
    if (TERMINAL_RESPONSE_STATUSES.has(app.status))
      add(applicationsWithResponse, app.id);
    if (["offer", "accepted"].includes(app.status))
      add(offerApplications, app.id);
    if (
      TERMINAL_RESPONSE_STATUSES.has(
        normalizeLabelKey(metadata.spreadsheet_outcome),
      )
    )
      add(applicationsWithResponse, app.id);
    if (isAssessmentLabel(metadata.spreadsheet_interview_stage)) {
      add(applicationsWithResponse, app.id);
      add(assessmentApplications, app.id);
    }
  }

  for (const message of outreachMessages) {
    if (message.direction === "inbound")
      add(applicationsWithResponse, message.applicationId);
  }
  for (const event of lifecycleEvents) {
    const eventType = normalizeLabelKey(event.eventType);
    if (isEmployerLifecycleResponse(event))
      add(applicationsWithResponse, event.applicationId);
    if (eventType === "hiring_manager_reply") outreachReplies += 1;
    if (
      ASSESSMENT_EVENT_TYPES.has(eventType) ||
      isAssessmentLabel(event.stageLabel)
    )
      add(assessmentApplications, event.applicationId);
    if (RECRUITER_SCREEN_EVENT_TYPES.has(eventType))
      add(recruiterScreenApplications, event.applicationId);
  }
  for (const interview of interviews) {
    if (interview.stage === "recruiter_screen")
      add(recruiterScreenApplications, interview.applicationId);
    else add(interviewApplications, interview.applicationId);
  }
  for (const offer of offers) {
    add(applicationsWithResponse, offer.applicationId);
    add(offerApplications, offer.applicationId);
  }

  const totalApplications = applications.length;
  return {
    totalApplications,
    outreachSent,
    outreachReplies,
    applicationsWithResponse: applicationsWithResponse.size,
    applicationResponseRate: percent(
      applicationsWithResponse.size,
      totalApplications,
    ),
    outreachReplyRate: percent(outreachReplies, outreachSent),
    recruiterScreens: recruiterScreenApplications.size,
    interviews: interviewApplications.size,
    assessments: assessmentApplications.size,
    offers: offerApplications.size,
  };
};
