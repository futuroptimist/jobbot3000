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
  REMINDER_ACTION: "reminder_action",
  UNKNOWN_METADATA: "unknown_metadata",
});

const EVENT_REGISTRY = Object.freeze({
  application_submitted: {
    category: LIFECYCLE_EVENT_CATEGORIES.APPLICATION_SUBMISSION,
    status: "applied",
  },
  hiring_manager_reply: {
    category: LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE,
    status: "outreach_sent",
    countsAsResponse: true,
  },
  employer_response_received: {
    category: LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE,
    countsAsResponse: true,
  },
  recruiter_screen: {
    category: LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN,
    status: "recruiter_screen",
    interviewStage: "recruiter_screen",
    countsAsResponse: true,
  },
  assessment_take_home: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  technical_interview: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    countsAsResponse: true,
  },
  onsite_final_loop: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "onsite_loop",
    interviewStage: "onsite_loop",
    countsAsResponse: true,
  },
  recruiter_screen_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN,
    status: "recruiter_screen",
    interviewStage: "recruiter_screen",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  recruiter_screen_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN,
    status: "recruiter_screen",
    interviewStage: "recruiter_screen",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  devops_interview_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  devops_interview_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  technical_interview_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  technical_interview_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  technical_screen_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  technical_screen_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "technical_screen",
    interviewStage: "technical_screen",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  onsite_interview_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "onsite_loop",
    interviewStage: "onsite_loop",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  onsite_interview_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "onsite_loop",
    interviewStage: "onsite_loop",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  final_interview_scheduled: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "onsite_loop",
    interviewStage: "onsite_loop",
    interviewOutcome: "scheduled",
    countsAsResponse: true,
  },
  final_interview_completed: {
    category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
    status: "onsite_loop",
    interviewStage: "onsite_loop",
    interviewOutcome: "completed",
    countsAsResponse: true,
  },
  written_assessment: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  written_assessment_requested: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  written_assessment_submitted: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  take_home: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  take_home_requested: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  take_home_submitted: {
    category: LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT,
    countsAsResponse: true,
  },
  next_tracking_step: {
    category: LIFECYCLE_EVENT_CATEGORIES.REMINDER_ACTION,
  },
});

export const classifyLifecycleEventType = (eventType) => ({
  category: LIFECYCLE_EVENT_CATEGORIES.UNKNOWN_METADATA,
  ...EVENT_REGISTRY[normalize(eventType)],
  eventType: normalize(eventType),
});

export const isLifecycleRecruiterScreen = (eventType) =>
  classifyLifecycleEventType(eventType).category ===
  LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN;

export const isLifecycleNonRecruiterInterview = (eventType) =>
  classifyLifecycleEventType(eventType).category ===
  LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW;

export const isLifecycleAssessment = (eventType) =>
  classifyLifecycleEventType(eventType).category ===
  LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT;
