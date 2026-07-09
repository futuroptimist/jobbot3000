const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const LIFECYCLE_EVENT_CATEGORIES = Object.freeze({
  RECRUITER_SCREEN: "recruiter_screen",
  NON_RECRUITER_INTERVIEW: "non_recruiter_interview",
  ASSESSMENT: "assessment_take_home",
  EMPLOYER_RESPONSE: "employer_response_engagement",
  APPLICATION_SUBMISSION: "application_submission",
  REMINDER_ACTION: "reminder_action",
  UNKNOWN_METADATA: "unknown_metadata_only",
});

const CATEGORY_BY_EVENT_TYPE = new Map(
  [
    [
      "application_submitted",
      LIFECYCLE_EVENT_CATEGORIES.APPLICATION_SUBMISSION,
    ],
    ["applied", LIFECYCLE_EVENT_CATEGORIES.APPLICATION_SUBMISSION],
    ["hiring_manager_reply", LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE],
    ["employer_reply", LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE],
    ["recruiter_reply", LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE],
    ["offer", LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE],
    ["offer_received", LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE],
    ["recruiter_screen_scheduled", LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN],
    ["recruiter_screen_completed", LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN],
    ["written_assessment", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["written_assessment_requested", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["written_assessment_submitted", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["take_home", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["take_home_requested", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["take_home_submitted", LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT],
    ["next_tracking_step", LIFECYCLE_EVENT_CATEGORIES.REMINDER_ACTION],
    ["follow_up", LIFECYCLE_EVENT_CATEGORIES.REMINDER_ACTION],
    ["follow_up_reminder", LIFECYCLE_EVENT_CATEGORIES.REMINDER_ACTION],
    [
      "devops_interview_scheduled",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "devops_interview_completed",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "technical_interview_scheduled",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "technical_interview_completed",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "technical_screen_scheduled",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "technical_screen_completed",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "onsite_interview_scheduled",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "onsite_interview_completed",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "final_interview_scheduled",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
    [
      "final_interview_completed",
      LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    ],
  ].map(([eventType, category]) => [normalize(eventType), category]),
);

const INTERVIEW_STAGE_BY_EVENT_TYPE = new Map(
  [
    ["devops_interview_scheduled", "technical_screen"],
    ["devops_interview_completed", "technical_screen"],
    ["technical_interview_scheduled", "technical_screen"],
    ["technical_interview_completed", "technical_screen"],
    ["technical_screen_scheduled", "technical_screen"],
    ["technical_screen_completed", "technical_screen"],
    ["onsite_interview_scheduled", "onsite_loop"],
    ["onsite_interview_completed", "onsite_loop"],
    ["final_interview_scheduled", "other"],
    ["final_interview_completed", "other"],
  ].map(([eventType, stage]) => [normalize(eventType), stage]),
);

export const normalizeLifecycleEventType = normalize;

export const classifyLifecycleEventType = (eventType) =>
  CATEGORY_BY_EVENT_TYPE.get(normalize(eventType)) ??
  LIFECYCLE_EVENT_CATEGORIES.UNKNOWN_METADATA;

export const isRecruiterScreenLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType) ===
  LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN;

export const isNonRecruiterInterviewLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType) ===
  LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW;

export const isAssessmentLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType) ===
  LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT;

export const isEmployerResponseLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType) ===
  LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE;

export const interviewStageForLifecycleEvent = (eventType) =>
  INTERVIEW_STAGE_BY_EVENT_TYPE.get(normalize(eventType));

export const lifecycleEventTypeRegistry = Object.freeze(
  Object.fromEntries(CATEGORY_BY_EVENT_TYPE),
);
