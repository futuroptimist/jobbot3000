/* global document */
/* eslint-disable max-len */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, getByRole } from "@testing-library/dom";
import { JSDOM } from "jsdom";
import { createLifecycleDiagramView } from "../src/web/tracker/lifecycleDiagram.js";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const bundle = {
  applications: [
    {
      id: "a1",
      company: "<img src=x onerror=alert(1)>",
      role: "Eng",
      status: "applied",
      origin: "application_submitted",
    },
    {
      id: "a2",
      company: "Beta",
      role: "Eng",
      status: "rejected",
      origin: "referral",
    },
  ],
  lifecycleEvents: [
    {
      id: "e1",
      applicationId: "a1",
      eventType: "application_submitted",
      occurredAt: "2026-01-01T10:00:00Z",
    },
    {
      id: "e2",
      applicationId: "a1",
      eventType: "assessment_take_home",
      occurredAt: "2026-01-02",
      occurredAtPrecision: "date",
    },
    {
      id: "e3",
      applicationId: "a2",
      eventType: "referral",
      occurredAtPrecision: "unknown",
    },
    {
      id: "e4",
      applicationId: "a2",
      eventType: "employer_rejected",
      occurredAt: "2026-01-03T10:00:00Z",
    },
  ],
};

const mount = (data = bundle, bucket = "current") => {
  const dom = new JSDOM(`<div id="root"></div>`, { pretendToBeVisual: true });
  global.document = dom.window.document;
  global.window = dom.window;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const root = document.querySelector("#root");
  const selected = [];
  const view = createLifecycleDiagramView(root, {
    onSelectBucket: (id) => selected.push(id),
  });
  view.update({
    timeline: buildLifecycleTimeline(data),
    snapshot: projectLifecycleAt(data, bucket),
    selectedBucketId: bucket,
    newerAvailable: bucket !== "current",
  });
  return { dom, root, view, selected };
};

afterEach(() => {
  vi.restoreAllMocks();
  delete global.document;
  delete global.window;
  delete global.ResizeObserver;
});

describe("lifecycle diagram view", () => {
  it("renders current by default with accessible svg, controls, and semantic totals", () => {
    const { root } = mount();
    expect(
      getByRole(root, "img", { name: /lifecycle sankey diagram/i }),
    ).toBeTruthy();
    expect(getByRole(root, "slider").getAttribute("aria-valuetext")).toContain(
      "Current",
    );
    expect(root.textContent).toContain("2 of 2 applications included");
    expect(getByRole(root, "table", { name: "Origins" }).textContent).toContain(
      "50%",
    );
    expect(
      getByRole(root, "table", { name: "Endpoints" }).textContent,
    ).toContain("50%");
  });

  it("supports historical bucket controls, date timestamp modes, and disabled states", () => {
    const timeline = buildLifecycleTimeline(bundle);
    const dateBucket = timeline.buckets.find((b) => b.kind === "date").id;
    const { root, selected } = mount(bundle, dateBucket);
    expect(root.textContent).toContain("Historical — Newer activity available");
    expect(getByRole(root, "slider").getAttribute("aria-valuetext")).toContain(
      "time not recorded",
    );
    fireEvent.click(getByRole(root, "button", { name: "Next event" }));
    expect(selected.at(-1)).toBeTruthy();
    fireEvent.click(getByRole(root, "button", { name: "Return to current" }));
    expect(selected.at(-1)).toBe("current");
  });

  it("renders unknown-only and empty states safely without mutating projection", () => {
    const snapshot = projectLifecycleAt(bundle, "unknown-date");
    const before = JSON.stringify(snapshot);
    const { root } = mount(bundle, "unknown-date");
    expect(getByRole(root, "slider").getAttribute("aria-valuetext")).toContain(
      "Unknown date",
    );
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(root.innerHTML).not.toContain("onerror");
    const empty = mount({ applications: [], lifecycleEvents: [] }).root;
    expect(empty.textContent).toContain("No lifecycle paths");
  });

  it("selection rows and svg clicks drive one details region without listener multiplication", () => {
    const { root, view, dom } = mount();
    const addSpy = vi.spyOn(
      dom.window.EventTarget.prototype,
      "addEventListener",
    );
    const initial = addSpy.mock.calls.length;
    view.update({
      timeline: buildLifecycleTimeline(bundle),
      snapshot: projectLifecycleAt(bundle),
      selectedBucketId: "current",
    });
    expect(addSpy.mock.calls.length - initial).toBeLessThan(20);
    const link = root.querySelector("path[data-diagram-id]");
    fireEvent.click(link);
    expect(root.querySelector("[data-diagram-details]").textContent).toContain(
      "applications",
    );
  });
});
