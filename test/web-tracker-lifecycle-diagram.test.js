/* global document */
// @vitest-environment jsdom
import { fireEvent, getByRole, getByText, within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLifecycleDiagramView } from "../src/web/tracker/lifecycleDiagram.js";
import {
  buildLifecycleTimeline,
  projectLifecycleAt,
} from "../src/web/tracker/lifecycleProjection.js";

const bundle = (applications = [], lifecycleEvents = []) => ({
  applications,
  lifecycleEvents,
});
const app = (id, overrides = {}) => ({
  id,
  company: `Company ${id}`,
  role: "Engineer",
  status: "applied",
  appliedAt: "2026-01-01",
  ...overrides,
});
const event = (id, applicationId, eventType, occurredAt, overrides = {}) => ({
  id,
  applicationId,
  eventType,
  occurredAt,
  source: "manual",
  ...overrides,
});

describe("lifecycle diagram view", () => {
  let root;
  beforeEach(() => {
    root = document.createElement("section");
    document.body.replaceChildren(root);
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders current by default with accessible SVG and semantic totals", () => {
    const data = bundle(
      [app("a1"), app("a2", { status: "offer" })],
      [
        event("e1", "a1", "application_submitted", "2026-01-01T10:00:00.000Z"),
        event("e2", "a2", "referral", "2026-01-01T10:00:00.000Z"),
        event("e3", "a2", "offer_received", "2026-01-03T10:00:00.000Z"),
      ],
    );
    createLifecycleDiagramView(root).update({ snapshot: data });
    expect(getByText(root, "Current")).toBeTruthy();
    expect(root.querySelector("svg[role='img'] title")?.textContent).toContain(
      "Application lifecycle diagram",
    );
    expect(root.querySelectorAll("[data-diagram-id]").length).toBeGreaterThan(
      0,
    );
    const origins = getByRole(root, "table", { name: "Origins" });
    expect(within(origins).getByText("Application Submitted")).toBeTruthy();
    expect(
      within(getByRole(root, "table", { name: "Endpoints" })).getByText(
        "Offer Negotiating",
      ),
    ).toBeTruthy();
    expect(root.textContent).toContain("2/2 applications");
  });

  it("supports empty, unknown-only, timestamp, and simultaneous-event states", () => {
    const view = createLifecycleDiagramView(root);
    view.update({ snapshot: bundle() });
    expect(root.querySelector("[data-diagram-empty]")?.textContent).toContain(
      "No application data",
    );
    const data = bundle(
      [app("a1")],
      [
        event("u1", "a1", "application_submitted", "", {
          occurredAtPrecision: "unknown",
        }),
        event("u2", "a1", "candidate_outreach", "", {
          occurredAtPrecision: "unknown",
        }),
      ],
    );
    view.update({ snapshot: data, selectedBucketId: "unknown-date" });
    expect(root.textContent).toContain(
      "Unknown date — off chronological scale",
    );
    expect(root.textContent).toContain("2 simultaneous/boundary events");
    expect(
      root.querySelector("input[type='range']")?.getAttribute("aria-valuetext"),
    ).toContain("Unknown date");
  });

  it("synchronizes controls and disabled states without persisting selection itself", () => {
    const data = bundle(
      [app("a1")],
      [event("e1", "a1", "application_submitted", "2026-01-02")],
    );
    const timeline = buildLifecycleTimeline(data);
    const seen = [];
    root.addEventListener("lifecycle-diagram-bucket", (e) =>
      seen.push(e.detail.bucketId),
    );
    createLifecycleDiagramView(root).update({
      snapshot: data,
      timeline,
      selectedBucketId: "current",
    });
    expect(getByRole(root, "button", { name: "Next event" }).disabled).toBe(
      true,
    );
    fireEvent.click(getByRole(root, "button", { name: "Previous event" }));
    expect(seen.at(-1)).toBe(timeline.buckets.at(-2).id);
    fireEvent.input(root.querySelector("input[type='range']"), {
      target: { value: "0" },
    });
    expect(seen.at(-1)).toBe("unknown-date");
  });

  it("selects node/link rows and leaves P4 projection immutable", () => {
    const data = bundle(
      [app("a1")],
      [event("e1", "a1", "application_submitted", "2026-01-01T10:00:00Z")],
    );
    const projection = projectLifecycleAt(data);
    expect(Object.isFrozen(projection.nodes[0])).toBe(true);
    createLifecycleDiagramView(root).update({ snapshot: data });
    fireEvent.click(
      within(getByRole(root, "table", { name: "Origins" })).getByRole(
        "button",
        { name: "Select" },
      ),
    );
    expect(root.querySelector("[data-diagram-details]")?.textContent).toContain(
      "1 application",
    );
    expect(projection.nodes.every((n) => n.x0 === undefined)).toBe(true);
  });

  it("registers one resize observer and removes it on destroy", () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({ observe, disconnect })),
    );
    const view = createLifecycleDiagramView(root);
    view.update({ snapshot: bundle([app("a1")]) });
    view.update({ snapshot: bundle([app("a1")]) });
    expect(observe).toHaveBeenCalledTimes(1);
    view.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("renders malicious-looking text inertly and uses no external references", () => {
    createLifecycleDiagramView(root).update({
      snapshot: bundle([app("<img src=x onerror=alert(1)>")]),
    });
    expect(root.querySelector("img")).toBeNull();
    expect([
      ...root.querySelectorAll("script, foreignObject, image, use"),
    ]).toHaveLength(0);
    expect(root.innerHTML).not.toContain("onerror");
  });
});
