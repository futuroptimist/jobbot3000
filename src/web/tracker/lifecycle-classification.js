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
  ASSESSMENT: "assessment",
  EMPLOYER_RESPONSE: "employer_response",
  APPLICATION_SUBMISSION: "application_submission",
  REMINDER: "reminder",
  UNKNOWN_METADATA: "unknown_metadata",
});

const EVENT_CATEGORY_ENTRIES = [
  [
    LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN,
    ["recruiter_screen_scheduled", "recruiter_screen_completed"],
  ],
  [
    LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    [
      "devops_interview_scheduled",
      "devops_interview_completed",
      "technical_interview_scheduled",
      "technical_interview_completed",
      "technical_screen_scheduled",
      "technical_screen_completed",
      "onsite_interview_scheduled",
      "onsite_interview_completed",
      "final_interview_scheduled",
      "final_interview_completed",
    ],
  ],
  [
    LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    [
      "written_assessment",
      "written_assessment_requested",
      "written_assessment_submitted",
      "take_home",
      "take_home_requested",
      "take_home_submitted",
    ],
  ],
  [
    LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE,
    ["hiring_manager_reply", "offer", "offer_received"],
  ],
  [
    LIFECYCLE_EVENT_CATEGORIES.APPLICATION_SUBMISSION,
    ["application_submitted"],
  ],
  [LIFECYCLE_EVENT_CATEGORIES.REMINDER, ["next_tracking_step"]],
];

const EVENT_CATEGORY_REGISTRY = new Map(
  EVENT_CATEGORY_ENTRIES.flatMap(([category, eventTypes]) =>
    eventTypes.map((eventType) => [eventType, category]),
  ),
);

const INTERVIEW_STAGE_BY_EVENT_TYPE = new Map([
  ["devops_interview_scheduled", "technical_screen"],
  ["devops_interview_completed", "technical_screen"],
  ["technical_interview_scheduled", "technical_screen"],
  ["technical_interview_completed", "technical_screen"],
  ["technical_screen_scheduled", "technical_screen"],
  ["technical_screen_completed", "technical_screen"],
  ["onsite_interview_scheduled", "onsite_loop"],
  ["onsite_interview_completed", "onsite_loop"],
  ["final_interview_scheduled", "onsite_loop"],
  ["final_interview_completed", "onsite_loop"],
  ["recruiter_screen_scheduled", "recruiter_screen"],
  ["recruiter_screen_completed", "recruiter_screen"],
]);

export const classifyLifecycleEventType = (eventType) =>
  EVENT_CATEGORY_REGISTRY.get(normalize(eventType)) ??
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

export const isKnownLifecycleEventType = (eventType) =>
  classifyLifecycleEventType(eventType) !==
  LIFECYCLE_EVENT_CATEGORIES.UNKNOWN_METADATA;

export const interviewStageForLifecycleEventType = (eventType) =>
  INTERVIEW_STAGE_BY_EVENT_TYPE.get(normalize(eventType));

export const lifecycleInterviewOutcomeForEventType = (eventType) => {
  const normalized = normalize(eventType);
  if (normalized.endsWith("_completed")) return "completed";
  if (normalized.endsWith("_scheduled")) return "scheduled";
  return undefined;
};
