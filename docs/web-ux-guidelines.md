# Web UX Guidelines

These guidelines describe the shared patterns that keep the jobbot3000 status hub consistent across
features. They document the layout system, typography scales, and interaction expectations that the
server templates in [`src/web/server.js`](../src/web/server.js) enforce. The roadmap entry in
[`docs/web-interface-roadmap.md`](web-interface-roadmap.md) called for a dedicated UX reference so
new surfaces stay aligned with the dark theme and accessibility guardrails already verified in
`test/web-server.test.js` and `test/web-status-hub-frontend.test.js`.

## Layout and spacing

- Use a 16px base grid with 24px/32px gaps between major sections (navigation, primary panels,
  drawers). Status panels rely on CSS grid for desktop and collapse into a single column via flexbox
  below 960px; see the `status-layout` rules in `src/web/server.js`.
- Preserve a 72px safe area at the top of drawers so header actions and breadcrumbs never overlap.
  Tests in `test/web-server.test.js` assert the drawer padding tokens remain exported from the
  stylesheet.
- Inline forms (filters, action panels) reserve 12px between controls and 20px between control groups
  so labels, helper text, and error banners stay scannable on mobile.

## Typography and hierarchy

- The hub uses the `--jobbot-font-family` token with a 15px body size and 17px line height; headings
  step up in a 1.25 modular scale. Apply `.text-title` for section titles and `.text-label` for field
  captions. `test/web-server.test.js` locks the CSS token exports, and
  `test/web-status-hub-frontend.test.js` exercises the focus order with the rendered heading levels.
- Avoid introducing custom font weights. Instead, use `.text-strong` for emphasis so the palette stays
  within the documented contrast ratios.
- Numbers and monospace snippets should use the `.text-mono` utility already emitted by the server
  stylesheet.

## Interaction patterns

- The navigation pills respond to arrow keys, Home/End, and click/touch events. Preserve the
  `aria-current="page"` attribute on the active link and ensure toggling routes fires the
  `jobbot:navigation-changed` event for plugins registered via `window.jobbotPluginHost`.
- Status panels expose `data-state-slot="ready|loading|error"` containers; hide/show them by toggling
  the `hidden` attribute only. Avoid inline `style` mutations so the DOM stays compatible with
  `docs/web-component-storybook.md` snippets.
- Form submissions should emit the existing `jobbot:*` events (`jobbot:application-status-recorded`,
  `jobbot:reminders-exported`) to keep analytics hooks working.

## Accessibility guardrails

- Maintain visible focus outlines supplied by `--jobbot-color-accent` and never suppress them in CSS.
- All interactive controls require discernible text or `aria-label` values. The storybook snippets and
  regression tests in `test/web-server.test.js` assert the presence of labels for buttons, toggles,
  and text inputs.
- Keep contrast ratios at WCAG AA or better using the semantic tokens defined in the stylesheet. The
  axe-core checks wired through `test/web-server.test.js` and the keyboard suite in
  `test/web-status-hub-frontend.test.js` guard the existing affordances.

## Asset references

- Component markup examples live in [`docs/web-component-storybook.md`](web-component-storybook.md)
  and mirror the DOM produced by `src/web/server.js`.
- Update the screenshots in [`docs/screenshots/`](screenshots) whenever layout or palette changes land
  so documentation matches the shipped UI.
- Reference the roadmap milestones in [`docs/web-interface-roadmap.md`](web-interface-roadmap.md) when
  introducing new panels or modifying navigation structure.

Keep this document alongside design tweaks so reviewers can confirm updates stay within the
established UX guardrails before landing in the status hub.
