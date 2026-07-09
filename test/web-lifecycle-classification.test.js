import { describe, expect, it } from "vitest";

import {
  classifyLifecycleEventType,
  interviewStageForLifecycleEvent,
  LIFECYCLE_EVENT_CATEGORIES,
} from "../src/web/tracker/lifecycleClassification.js";

const {
  NON_RECRUITER_INTERVIEW,
  RECRUITER_SCREEN,
  ASSESSMENT,
  EMPLOYER_RESPONSE,
  REMINDER_ACTION,
} = LIFECYCLE_EVENT_CATEGORIES;

describe("lifecycle event classification", () => {
  it.each([
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
  ])("classifies %s as a non-recruiter interview", (eventType, stage) => {
    expect(classifyLifecycleEventType(eventType)).toBe(NON_RECRUITER_INTERVIEW);
    expect(interviewStageForLifecycleEvent(eventType)).toBe(stage);
  });

  it.each([
    ["recruiter_screen_scheduled", RECRUITER_SCREEN],
    ["recruiter_screen_completed", RECRUITER_SCREEN],
    ["written_assessment_submitted", ASSESSMENT],
    ["hiring_manager_reply", EMPLOYER_RESPONSE],
    ["follow_up", REMINDER_ACTION],
  ])("keeps %s out of non-recruiter interviews", (eventType, category) => {
    expect(classifyLifecycleEventType(eventType)).toBe(category);
    expect(interviewStageForLifecycleEvent(eventType)).toBeUndefined();
  });
});
