const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const EVENT_TYPE_CLASSIFICATIONS = new Map([
  [
    "recruiter_screen_scheduled",
    {
      category: "recruiter_screen",
      status: "recruiter_screen",
      interviewStage: "recruiter_screen",
      outcome: "scheduled",
    },
  ],
  [
    "recruiter_screen_completed",
    {
      category: "recruiter_screen",
      status: "recruiter_screen",
      interviewStage: "recruiter_screen",
      outcome: "completed",
    },
  ],
  [
    "devops_interview_scheduled",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "scheduled",
    },
  ],
  [
    "devops_interview_completed",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "completed",
    },
  ],
  [
    "technical_interview_scheduled",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "scheduled",
    },
  ],
  [
    "technical_interview_completed",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "completed",
    },
  ],
  [
    "technical_screen_scheduled",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "scheduled",
    },
  ],
  [
    "technical_screen_completed",
    {
      category: "non_recruiter_interview",
      status: "technical_screen",
      interviewStage: "technical_screen",
      outcome: "completed",
    },
  ],
  [
    "onsite_interview_scheduled",
    {
      category: "non_recruiter_interview",
      status: "onsite_loop",
      interviewStage: "onsite_loop",
      outcome: "scheduled",
    },
  ],
  [
    "onsite_interview_completed",
    {
      category: "non_recruiter_interview",
      status: "onsite_loop",
      interviewStage: "onsite_loop",
      outcome: "completed",
    },
  ],
  [
    "final_interview_scheduled",
    {
      category: "non_recruiter_interview",
      status: "onsite_loop",
      interviewStage: "onsite_loop",
      outcome: "scheduled",
    },
  ],
  [
    "final_interview_completed",
    {
      category: "non_recruiter_interview",
      status: "onsite_loop",
      interviewStage: "onsite_loop",
      outcome: "completed",
    },
  ],
  ["written_assessment", { category: "assessment", status: "applied" }],
  [
    "written_assessment_requested",
    { category: "assessment", status: "applied" },
  ],
  [
    "written_assessment_submitted",
    { category: "assessment", status: "applied" },
  ],
  ["take_home", { category: "assessment", status: "applied" }],
  ["take_home_requested", { category: "assessment", status: "applied" }],
  ["take_home_submitted", { category: "assessment", status: "applied" }],
  [
    "hiring_manager_reply",
    { category: "employer_response", status: "outreach_sent" },
  ],
  ["offer", { category: "employer_response", status: "offer" }],
  ["offer_received", { category: "employer_response", status: "offer" }],
  [
    "application_submitted",
    { category: "application_submission", status: "applied" },
  ],
  ["next_tracking_step", { category: "reminder" }],
  ["lifecycle_event", { category: "unknown" }],
]);

export const normalizeLifecycleEventType = normalize;

export const classifyLifecycleEventType = (eventType) => {
  const normalizedEventType = normalize(eventType);
  return {
    eventType: normalizedEventType,
    category:
      EVENT_TYPE_CLASSIFICATIONS.get(normalizedEventType)?.category ??
      "unknown",
    ...EVENT_TYPE_CLASSIFICATIONS.get(normalizedEventType),
  };
};

export const isRecruiterScreenLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType).category === "recruiter_screen";

export const isNonRecruiterInterviewLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType).category === "non_recruiter_interview";

export const isAssessmentLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType).category === "assessment";

export const isEmployerResponseLifecycleEvent = (eventType) =>
  classifyLifecycleEventType(eventType).category === "employer_response";
