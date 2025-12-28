# Status hub component storybook

The status hub renders each data set inside a reusable **status panel**. Panels expose `ready`,
`loading`, and `error` slots so the UI can swap between real data, skeletons, and inline error
messages without duplicating markup. The snippets below capture the canonical structure for every
panel rendered by [`startWebServer`](../src/web/server.js).

## Shared status panel anatomy

Each panel carries the `.status-panel` class, announces updates via `aria-live="polite"`, and wraps
three slot containers. Consumers should only toggle the `hidden` attribute on slot containers or the
`data-state` attribute on the root wrapper—never mutate the markup itself.

```html
<div
  class="status-panel"
  data-status-panel="applications"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <p class="status-panel__empty" data-shortlist-empty hidden>
      No matching applications found.
    </p>
    <!-- application table + detail drawer rendered here -->
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading shortlist entries…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load shortlist</strong>
      <p
        data-error-message
        data-error-default="Check the server logs or retry shortly."
      >
        Check the server logs or retry shortly.
      </p>
    </div>
  </div>
</div>
```

## Panel catalogue

### Reminders (`reminders`)

The reminders panel renders the follow-ups sidebar, including snooze/done controls and calendar
export actions. The ready slot hosts the sidebar markup; loading and error slots mirror the live UI
with the same data attributes used by the client script.

```html
<div
  class="status-panel"
  data-status-panel="reminders"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <div class="reminders-panel">
      <div class="reminders-panel__header">
        <div>
          <h3>Follow-ups</h3>
          <p class="muted">
            Track past-due and upcoming reminders without leaving the shortlist.
          </p>
        </div>
        <div class="reminders-panel__actions">
          <button type="button" class="button" data-reminders-refresh>
            Refresh follow-ups
          </button>
        </div>
      </div>
      <div class="reminders-panel__sections" data-reminders-sections></div>
      <p class="muted" data-reminders-empty hidden>No reminders queued.</p>
    </div>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading reminders…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load reminders</strong>
      <p data-error-message>Check the server logs and retry shortly.</p>
    </div>
  </div>
</div>
```

### Applications (`applications`)

The shortlist panel renders filter controls, a paginated results table, and the application detail
drawer. The ready state uses data attributes (`data-shortlist-*`) consumed by the client script to
inject rows, pagination metadata, and status updates.

```html
<div
  class="status-panel"
  data-status-panel="applications"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <table class="shortlist-table" data-shortlist-table hidden>
      <thead>
        <tr>
          <th scope="col">Job ID</th>
          <th scope="col">Location</th>
          <th scope="col">Level</th>
          <th scope="col">Compensation</th>
          <th scope="col">Tags</th>
          <th scope="col">Synced</th>
          <th scope="col">Discard summary</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody data-shortlist-body>
        <tr>
          <th scope="row">SWE-1234</th>
          <td>Remote</td>
          <td>Senior</td>
          <td>$185k</td>
          <td>dream,remote</td>
          <td>2025-10-10</td>
          <td>No discards recorded.</td>
          <td>
            <button type="button" data-shortlist-show="SWE-1234">
              Open detail
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="pagination" data-shortlist-pagination hidden>
      <button type="button" data-shortlist-prev>Previous</button>
      <span class="pagination-info" data-shortlist-range
        >Showing 1-10 of 42</span
      >
      <button type="button" data-shortlist-next>Next</button>
    </div>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading shortlist entries…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load shortlist</strong>
      <p
        data-error-message
        data-error-default="Check the server logs or retry shortly."
      >
        Check the server logs or retry shortly.
      </p>
    </div>
  </div>
</div>
```

### Listings (`listings`)

Listings reuse the shared panel skeleton but swap in a responsive grid for provider results. The grid
items match the card markup emitted by the live adapter.

```html
<div
  class="status-panel"
  data-status-panel="listings"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <div class="listings-grid" data-listings-results>
      <article class="listing-card">
        <header>
          <h3>Senior Platform Engineer</h3>
          <p>Greenhouse — Remote</p>
        </header>
        <p data-listings-description>
          Help scale jobbot3000's ingestion pipeline while keeping the CLI
          experience delightful.
        </p>
        <footer>
          <button
            type="button"
            data-listings-ingest="greenhouse:acme:senior-platform"
          >
            Track job
          </button>
        </footer>
      </article>
    </div>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading listings…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load listings</strong>
      <p
        data-error-message
        data-error-default="Check the provider details and retry."
      >
        Check the provider details and retry.
      </p>
    </div>
  </div>
</div>
```

### Commands (`commands`)

The commands panel shows the allow-listed CLI surface. The ready slot renders an HTML list of command
slugs and descriptions sourced from `ALLOW_LISTED_COMMANDS`.

```html
<div
  class="status-panel"
  data-status-panel="commands"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <p>
      The adapter only exposes safe CLI entry points. Each command requires a
      CSRF header.
    </p>
    <ul>
      <li><code>POST /commands/summarize</code> → Summarize job postings.</li>
      <li><code>POST /commands/match</code> → Compare resumes to jobs.</li>
      <li>
        <code>POST /commands/analytics-export</code> → Download funnel exports.
      </li>
    </ul>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading allow-listed commands…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load commands</strong>
      <p
        data-error-message
        data-error-default="Please refresh the page or retry shortly."
      >
        Please refresh the page or retry shortly.
      </p>
    </div>
  </div>
</div>
```

### Analytics (`analytics`)

Analytics pair the shared skeleton with a download toolbar and funnel table. The example below shows
redacted company names enabled by default.

```html
<div
  class="status-panel"
  data-status-panel="analytics"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <div data-analytics-summary>
      <p data-analytics-totals>Tracked jobs: 18</p>
      <p data-analytics-dropoff>Largest drop-off: Interviews → Offers</p>
    </div>
    <div class="analytics-actions">
      <button type="button" data-analytics-export-json>Download JSON</button>
      <button type="button" data-analytics-export-csv>Download CSV</button>
      <label class="analytics-actions__toggle">
        <input
          type="checkbox"
          name="analytics-redact"
          data-analytics-redact-toggle
          checked
        />
        Redact company names
      </label>
    </div>
    <table class="shortlist-table" data-analytics-table>
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col">Count</th>
          <th scope="col">Conversion</th>
          <th scope="col">Drop-off</th>
        </tr>
      </thead>
      <tbody data-analytics-rows>
        <tr>
          <th scope="row">Applied</th>
          <td>18</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <th scope="row">Interview</th>
          <td>8</td>
          <td>44%</td>
          <td>-56%</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading analytics funnel…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Unable to load analytics</strong>
      <p
        data-error-message
        data-error-default="Check the server logs or retry shortly."
      >
        Check the server logs or retry shortly.
      </p>
    </div>
  </div>
</div>
```

### Audits (`audits`)

Audit results highlight reference documentation and keep the grid layout used across the live UI.

```html
<div
  class="status-panel"
  data-status-panel="audits"
  data-state="ready"
  aria-live="polite"
>
  <div data-state-slot="ready">
    <div class="grid two-column">
      <p>
        Continuous accessibility checks rely on <code>axe-core</code>.
        Performance scoring mirrors Lighthouse arithmetic mean weighting.
      </p>
      <article class="card references">
        <h3>Helpful references</h3>
        <nav aria-label="Documentation links">
          <ul>
            <li>
              <a href="https://github.com/jobbot3000/jobbot3000">Repository</a>
            </li>
            <li><a href="../README.md">README</a></li>
            <li>
              <a href="./web-interface-roadmap.md">Web interface roadmap</a>
            </li>
            <li>
              <a href="./web-operational-playbook.md">Operations playbook</a>
            </li>
          </ul>
        </nav>
      </article>
    </div>
  </div>
  <div data-state-slot="loading" hidden>
    <p class="status-panel__loading" role="status" aria-live="polite">
      Loading automated audit results…
    </p>
  </div>
  <div data-state-slot="error" hidden>
    <div class="status-panel__error" role="alert">
      <strong>Audit status unavailable</strong>
      <p
        data-error-message
        data-error-default="Check the server logs and reload to fetch audit results."
      >
        Check the server logs and reload to fetch audit results.
      </p>
    </div>
  </div>
</div>
```

## Event hooks

The client script dispatches DOM events whenever panel state changes:

| Event                                                | Payload                  | Description                                       |
| ---------------------------------------------------- | ------------------------ | ------------------------------------------------- |
| `jobbot:status-panels-ready`                         | `{ panels: string[] }`   | Fired after the DOM hydrator wires status panels. |
| `jobbot:application-status-recorded`                 | `{ jobId, statusLabel }` | Emitted when a status update succeeds.            |
| `jobbot:analytics-ready` / `jobbot:analytics-loaded` | `{ totals, dropoff }`    | Announce analytics summary hydration.             |
| `jobbot:analytics-exported`                          | `{ format, redacted }`   | Fired after JSON or CSV downloads complete.       |

Listening for these events is the safest way to extend the UI without re-implementing core logic.
