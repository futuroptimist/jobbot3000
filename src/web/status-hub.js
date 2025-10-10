/* eslint-env browser */
/* global document, window, localStorage, Element */

(() => {
        const themeStorageKey = 'jobbot:web:theme';
        const routeStorageKey = 'jobbot:web:route';
        const root = document.documentElement;
        const toggle = document.querySelector('[data-theme-toggle]');
        const label = toggle ? toggle.querySelector('[data-theme-toggle-label]') : null;
        const router = document.querySelector('[data-router]');
        const routeSections = router ? Array.from(router.querySelectorAll('[data-route]')) : [];
        const routeNames = new Set(
          routeSections.map(section => section.getAttribute('data-route')),
        );
        const navLinks = Array.from(document.querySelectorAll('[data-route-link]'));
        const statusPanels = new Map();
        const csrfHeader = document.body?.dataset.csrfHeader || '';
        const csrfToken = document.body?.dataset.csrfToken || '';
        const routeListeners = new Map();

        function normalizePanelId(value) {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }

        function describePanel(panel) {
          const id = normalizePanelId(panel.getAttribute('data-status-panel'));
          if (!id) {
            return null;
          }

          const slotElements = Array.from(panel.querySelectorAll('[data-state-slot]'));
          if (slotElements.length === 0) {
            return null;
          }

          const slots = new Map();
          for (const slot of slotElements) {
            const state = normalizePanelId(slot.getAttribute('data-state-slot'));
            if (!state) {
              continue;
            }
            slots.set(state, slot);
          }

          if (slots.size === 0) {
            return null;
          }

          const initialStateAttr = normalizePanelId(panel.getAttribute('data-state'));
          const defaultState = initialStateAttr && slots.has(initialStateAttr)
            ? initialStateAttr
            : slots.has('ready')
              ? 'ready'
              : slots.keys().next().value;
          const messageElement = panel.querySelector('[data-error-message]');

          return {
            id,
            element: panel,
            slots,
            defaultState,
            messageElement,
            messageDefault:
              messageElement?.dataset.errorDefault?.trim() ??
              messageElement?.textContent ??
              '',
            state: null,
          };
        }

        function applyPanelState(panel, nextState, options = {}) {
          if (!panel) {
            return false;
          }
          const normalized = panel.slots.has(nextState) ? nextState : panel.defaultState;
          for (const [stateName, slotElement] of panel.slots) {
            if (stateName === normalized) {
              slotElement.removeAttribute('hidden');
            } else {
              slotElement.setAttribute('hidden', '');
            }
          }

          panel.element.setAttribute('data-state', normalized);
          if (normalized === 'loading') {
            panel.element.setAttribute('aria-busy', 'true');
          } else {
            panel.element.removeAttribute('aria-busy');
          }

          if (panel.messageElement) {
            if (normalized === 'error') {
              const provided = typeof options.message === 'string' ? options.message.trim() : '';
              panel.messageElement.textContent = provided || panel.messageDefault;
            } else if (!options.preserveMessage) {
              panel.messageElement.textContent = panel.messageDefault;
            }
          }

          panel.state = normalized;
          return true;
        }

        function setPanelState(id, state, options = {}) {
          const normalizedId = normalizePanelId(id);
          if (!normalizedId) {
            return false;
          }
          const panel = statusPanels.get(normalizedId);
          if (!panel) {
            return false;
          }
          return applyPanelState(panel, normalizePanelId(state) ?? state, options);
        }

        function getPanelState(id) {
          const normalizedId = normalizePanelId(id);
          return normalizedId ? statusPanels.get(normalizedId)?.state ?? null : null;
        }

        function listStatusPanelIds() {
          return Array.from(statusPanels.keys());
        }

        function initializeStatusPanels() {
          statusPanels.clear();
          const panels = Array.from(document.querySelectorAll('[data-status-panel]'));
          for (const element of panels) {
            const descriptor = describePanel(element);
            if (!descriptor) {
              continue;
            }
            statusPanels.set(descriptor.id, descriptor);
            applyPanelState(descriptor, descriptor.state ?? descriptor.defaultState);
          }
        }

        function buildCommandUrl(pathname) {
          return new URL(pathname, window.location.href);
        }

        async function postCommand(pathname, payload, { invalidResponse, failureMessage }) {
          if (typeof fetch !== 'function') {
            throw new Error('Fetch API is unavailable in this environment');
          }
          const headers = { 'content-type': 'application/json' };
          if (csrfHeader && csrfToken) {
            headers[csrfHeader] = csrfToken;
          }
          const response = await fetch(buildCommandUrl(pathname), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          let parsed;
          try {
            parsed = await response.json();
          } catch {
            throw new Error(invalidResponse);
          }
          if (!response.ok) {
            const message =
              parsed && typeof parsed.error === 'string' ? parsed.error : failureMessage;
            throw new Error(message);
          }
          const data = parsed?.data;
          if (!data || typeof data !== 'object') {
            throw new Error(invalidResponse);
          }
          return data;
        }

        function setupShortlistView() {
          const section = document.querySelector('[data-route="applications"]');
          if (!section) {
            return null;
          }

          const form = section.querySelector('[data-shortlist-filters]');
          const inputs = {
            location: form?.querySelector('[data-shortlist-filter="location"]') ?? null,
            level: form?.querySelector('[data-shortlist-filter="level"]') ?? null,
            compensation: form?.querySelector('[data-shortlist-filter="compensation"]') ?? null,
            tags: form?.querySelector('[data-shortlist-filter="tags"]') ?? null,
            limit: form?.querySelector('[data-shortlist-filter="limit"]') ?? null,
          };
          const resetButton = section.querySelector('[data-shortlist-reset]');
          const table = section.querySelector('[data-shortlist-table]');
          const tbody = section.querySelector('[data-shortlist-body]');
          const emptyState = section.querySelector('[data-shortlist-empty]');
          const pagination = section.querySelector('[data-shortlist-pagination]');
          const range = section.querySelector('[data-shortlist-range]');
          const prevButton = section.querySelector('[data-shortlist-prev]');
          const nextButton = section.querySelector('[data-shortlist-next]');
          const detailElements = (() => {
            const container = section.querySelector('[data-application-detail]');
            if (!container) return null;
            return {
              container,
              blocks: {
                empty: container.querySelector('[data-detail-state="empty"]'),
                loading: container.querySelector('[data-detail-state="loading"]'),
                error: container.querySelector('[data-detail-state="error"]'),
                ready: container.querySelector('[data-detail-state="ready"]'),
              },
              title: container.querySelector('[data-detail-title]'),
              meta: container.querySelector('[data-detail-meta]'),
              tags: container.querySelector('[data-detail-tags]'),
              discard: container.querySelector('[data-detail-discard]'),
              events: container.querySelector('[data-detail-events]'),
              errorMessage: container.querySelector('[data-detail-error]'),
            };
          })();
          const detailState = { loading: false, jobId: null };
          const actionElements = (() => {
            const container = section.querySelector('[data-application-actions]');
            if (!container) return null;
            const form = container.querySelector('[data-application-status-form]');
            return {
              container,
              form,
              status: container.querySelector('[data-application-status]'),
              note: container.querySelector('[data-application-note]'),
              clear: container.querySelector('[data-action-clear]'),
              message: container.querySelector('[data-action-message]'),
              submit: form?.querySelector('button[type="submit"]') ?? null,
            };
          })();
          const actionState = { jobId: null, submitting: false, enabled: false };

          function formatStatusLabelText(value) {
            return (value || '')
              .split('_')
              .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
              .join(' ');
          }

          function setActionMessage(variant, text) {
            if (!actionElements?.message) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              actionElements.message.textContent = '';
              actionElements.message.setAttribute('hidden', '');
              actionElements.message.removeAttribute('data-variant');
              return;
            }
            actionElements.message.textContent = messageText;
            actionElements.message.setAttribute('data-variant', variant);
            actionElements.message.removeAttribute('hidden');
          }

          function resetActionForm(options = {}) {
            if (!actionElements) return;
            if (actionElements.status) actionElements.status.value = '';
            if (actionElements.note) actionElements.note.value = '';
            if (!options.preserveMessage) {
              setActionMessage(null);
            }
          }

          function updateActionControls(options = {}) {
            if (!actionElements) return;
            if (typeof options.enabled === 'boolean') {
              actionState.enabled = options.enabled;
            }
            if (typeof options.submitting === 'boolean') {
              actionState.submitting = options.submitting;
            }
            const disabled = !actionState.enabled || actionState.submitting;
            const controls = [
              actionElements.status,
              actionElements.note,
              actionElements.submit,
              actionElements.clear,
            ];
            for (const control of controls) {
              if (control) {
                control.disabled = disabled;
              }
            }
          }

          function updateActionVisibility(visible) {
            if (!actionElements?.container) return;
            if (visible) {
              actionElements.container.removeAttribute('hidden');
            } else {
              actionElements.container.setAttribute('hidden', '');
            }
          }

          function prepareActionPanel(jobId, { preserveMessage = false } = {}) {
            if (!actionElements) return;
            actionState.jobId = jobId;
            if (!jobId) {
              resetActionForm({ preserveMessage: false });
              updateActionControls({ enabled: false, submitting: false });
              updateActionVisibility(false);
              return;
            }
            resetActionForm({ preserveMessage });
            updateActionControls({ enabled: true, submitting: false });
            updateActionVisibility(true);
          }

          if (actionElements) {
            prepareActionPanel(null);
          }

          function clampLimit(value) {
            const number = Number.parseInt(value, 10);
            if (!Number.isFinite(number) || Number.isNaN(number)) {
              return 10;
            }
            if (number < 1) return 1;
            if (number > 100) return 100;
            return number;
          }

          const defaultLimit = clampLimit(inputs.limit?.value ?? 10);
          if (inputs.limit) {
            inputs.limit.value = String(defaultLimit);
          }

          const state = {
            loaded: false,
            loading: false,
            offset: 0,
            limit: defaultLimit,
            total: 0,
            filters: {},
            lastError: null,
          };

          function parseTags(value) {
            if (!value) return [];
            return value
              .split(',')
              .map(entry => entry.trim())
              .filter(entry => entry.length > 0);
          }

          function readFiltersFromInputs() {
            const filters = {};
            const location = inputs.location?.value?.trim();
            if (location) filters.location = location;
            const level = inputs.level?.value?.trim();
            if (level) filters.level = level;
            const compensation = inputs.compensation?.value?.trim();
            if (compensation) filters.compensation = compensation;
            const tagsList = parseTags(inputs.tags?.value ?? '');
            if (tagsList.length > 0) {
              filters.tags = tagsList;
            }
            return filters;
          }

          function buildRequestPayload(filters, offset, limit) {
            const payload = { offset, limit };
            if (filters.location) payload.location = filters.location;
            if (filters.level) payload.level = filters.level;
            if (filters.compensation) payload.compensation = filters.compensation;
            if (Array.isArray(filters.tags) && filters.tags.length > 0) {
              payload.tags = filters.tags;
            }
            return payload;
          }

          function buildDiscardSummary(count, summary) {
            if (!count || count <= 0 || !summary || typeof summary !== 'object') {
              return 'No discards';
            }
            const reason = summary.reason || 'Unknown reason';
            const when = summary.discarded_at || '(unknown time)';
            const tagsSummary =
              Array.isArray(summary.tags) && summary.tags.length > 0
                ? 'Tags: ' + summary.tags.join(', ')
                : '';
            const parts = ['Count: ' + count, reason + ' (' + when + ')'];
            if (tagsSummary) parts.push(tagsSummary);
            return parts.join(' • ');
          }

          function toggleDetailVisibility(visible) {
            if (!detailElements?.container) return;
            if (visible) {
              detailElements.container.removeAttribute('hidden');
            } else {
              detailElements.container.setAttribute('hidden', '');
            }
            if (actionElements?.container) {
              if (visible && actionState.jobId) {
                updateActionVisibility(true);
              } else if (!visible) {
                updateActionVisibility(false);
              }
            }
          }

          function setDetailState(state, options = {}) {
            if (!detailElements) return;
            const blocks = detailElements.blocks || {};
            const target = blocks[state] ? state : 'empty';
            const forceVisible = options.forceVisible === true;
            if (target === 'empty' && !forceVisible) {
              toggleDetailVisibility(false);
            } else {
              toggleDetailVisibility(true);
            }
            for (const [name, element] of Object.entries(blocks)) {
              if (!element) continue;
              if (name === target) {
                element.removeAttribute('hidden');
              } else {
                element.setAttribute('hidden', '');
              }
            }
            if (detailElements.errorMessage) {
              const defaultMessage =
                detailElements.errorMessage.getAttribute('data-detail-error-default') ||
                'Retry or check server logs.';
              if (target === 'error') {
                const message =
                  typeof options.message === 'string' && options.message.trim()
                    ? options.message.trim()
                    : defaultMessage;
                detailElements.errorMessage.textContent = message;
              } else {
                detailElements.errorMessage.textContent = defaultMessage;
              }
            }
            if (actionElements) {
              if (target === 'ready' && detailState.jobId) {
                prepareActionPanel(detailState.jobId, { preserveMessage: options.preserveMessage });
              } else if (target !== 'ready') {
                prepareActionPanel(null);
              }
            }
          }

          function clearDetailContents() {
            if (!detailElements) return;
            if (detailElements.title) detailElements.title.textContent = '';
            if (detailElements.meta) detailElements.meta.textContent = '';
            if (detailElements.tags) detailElements.tags.textContent = '';
            if (detailElements.discard) detailElements.discard.textContent = '';
            if (detailElements.events) detailElements.events.textContent = '';
          }

          function renderDetail(jobId, data) {
            if (!detailElements) return;
            detailState.jobId = jobId;
            clearDetailContents();
            const metadata = data && typeof data === 'object' ? data.metadata || {} : {};

            if (detailElements.title) {
              detailElements.title.textContent = 'Application ' + jobId;
            }

            if (detailElements.meta) {
              const fragment = document.createDocumentFragment();
              const entries = [
                ['Location', metadata?.location || '—'],
                ['Level', metadata?.level || '—'],
                ['Compensation', metadata?.compensation || '—'],
                ['Synced', metadata?.synced_at || '—'],
              ];
              for (const [label, value] of entries) {
                const dt = document.createElement('dt');
                dt.textContent = label;
                fragment.appendChild(dt);
                const dd = document.createElement('dd');
                dd.textContent = value || '—';
                fragment.appendChild(dd);
              }
              detailElements.meta.appendChild(fragment);
            }

            if (detailElements.tags) {
              const tags = Array.isArray(data?.tags)
                ? data.tags.filter(tag => typeof tag === 'string' && tag.trim())
                : [];
              detailElements.tags.textContent =
                tags.length > 0 ? 'Tags: ' + tags.join(', ') : 'Tags: (none)';
            }

            if (detailElements.discard) {
              const count =
                typeof data?.discard_count === 'number' ? data.discard_count : 0;
              const parts = ['Discard count: ' + count];
              if (data?.last_discard && typeof data.last_discard === 'object') {
                const reason =
                  typeof data.last_discard.reason === 'string' && data.last_discard.reason.trim()
                    ? data.last_discard.reason.trim()
                    : 'Unknown reason';
                const when =
                  typeof data.last_discard.discarded_at === 'string' &&
                  data.last_discard.discarded_at.trim()
                    ? data.last_discard.discarded_at.trim()
                    : 'unknown time';
                parts.push('Last discard: ' + reason + ' (' + when + ')');
                const discardTags = Array.isArray(data.last_discard.tags)
                  ? data.last_discard.tags.filter(tag => typeof tag === 'string' && tag.trim())
                  : [];
                const tagSummary =
                  discardTags.length > 0 ? discardTags.join(', ') : '(none)';
                parts.push('Last discard tags: ' + tagSummary);
              } else if (count === 0) {
                parts.push('No discards recorded.');
              }
              detailElements.discard.textContent = parts.join(' • ');
            }

            if (detailElements.events) {
              detailElements.events.textContent = '';
              const events = Array.isArray(data?.events) ? data.events : [];
              if (events.length === 0) {
                const empty = document.createElement('li');
                empty.className = 'application-detail__empty';
                empty.textContent = 'No timeline entries recorded.';
                detailElements.events.appendChild(empty);
              } else {
                for (const entry of events) {
                  const li = document.createElement('li');
                  const header = document.createElement('div');
                  header.className = 'application-detail__event-header';
                  const headerParts = [];
                  if (typeof entry?.channel === 'string' && entry.channel.trim()) {
                    headerParts.push(entry.channel.trim());
                  }
                  if (typeof entry?.date === 'string' && entry.date.trim()) {
                    headerParts.push('(' + entry.date.trim() + ')');
                  }
                  header.textContent = headerParts.length > 0 ? headerParts.join(' ') : 'Event';
                  li.appendChild(header);
                  if (typeof entry?.contact === 'string' && entry.contact.trim()) {
                    const contact = document.createElement('div');
                    contact.textContent = 'Contact: ' + entry.contact.trim();
                    li.appendChild(contact);
                  }
                  if (typeof entry?.note === 'string' && entry.note.trim()) {
                    const note = document.createElement('div');
                    note.textContent = 'Note: ' + entry.note.trim();
                    li.appendChild(note);
                  }
                  if (Array.isArray(entry?.documents) && entry.documents.length > 0) {
                    const documentsList = entry.documents
                      .filter(doc => typeof doc === 'string' && doc.trim())
                      .join(', ');
                    if (documentsList) {
                      const documents = document.createElement('div');
                      documents.textContent = 'Documents: ' + documentsList;
                      li.appendChild(documents);
                    }
                  }
                  if (typeof entry?.remind_at === 'string' && entry.remind_at.trim()) {
                    const remind = document.createElement('div');
                    remind.textContent = 'Reminder: ' + entry.remind_at.trim();
                    li.appendChild(remind);
                  }
                  detailElements.events.appendChild(li);
                }
              }
            }
          }

          function renderRows(items) {
            if (!tbody) return;
            tbody.textContent = '';
            if (!Array.isArray(items) || items.length === 0) {
              emptyState?.removeAttribute('hidden');
              table?.setAttribute('hidden', '');
              pagination?.setAttribute('hidden', '');
              return;
            }

            emptyState?.setAttribute('hidden', '');
            table?.removeAttribute('hidden');

            const fragment = document.createDocumentFragment();
            for (const item of items) {
              const row = document.createElement('tr');
              const hasMetadata =
                item &&
                typeof item === 'object' &&
                item.metadata &&
                typeof item.metadata === 'object';
              const metadata = hasMetadata ? item.metadata : {};
              const tagsList = Array.isArray(item?.tags)
                ? item.tags.filter(tag => typeof tag === 'string' && tag.trim())
                : [];
              const discardCount = typeof item?.discard_count === 'number' ? item.discard_count : 0;
              const hasLastDiscard =
                item &&
                typeof item === 'object' &&
                item.last_discard &&
                typeof item.last_discard === 'object';
              const lastDiscard = hasLastDiscard ? item.last_discard : null;

              const jobId =
                item && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : 'Unknown';
              const cells = [
                jobId,
                metadata.location || '—',
                metadata.level || '—',
                metadata.compensation || '—',
                tagsList.length > 0 ? tagsList.join(', ') : '—',
                metadata.synced_at || '—',
                buildDiscardSummary(discardCount, lastDiscard),
              ];

              row.setAttribute('data-job-id', jobId);

              for (const value of cells) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
              }

              const actionCell = document.createElement('td');
              const viewButton = document.createElement('button');
              viewButton.type = 'button';
              viewButton.className = 'link-button';
              viewButton.textContent = 'View details';
              viewButton.setAttribute('data-shortlist-view', jobId);
              actionCell.appendChild(viewButton);
              row.appendChild(actionCell);
              fragment.appendChild(row);
            }

            tbody.appendChild(fragment);
            pagination?.removeAttribute('hidden');
          }

          async function loadDetail(jobId) {
            if (!detailElements || !jobId) {
              return;
            }
            if (detailState.loading && detailState.jobId === jobId) {
              return;
            }
            detailState.loading = true;
            detailState.jobId = jobId;
            setDetailState('loading', { forceVisible: true });
            try {
              const data = await fetchShortlistDetail(jobId);
              if (detailState.jobId !== jobId) {
                return;
              }
              renderDetail(jobId, data);
              setDetailState('ready', { forceVisible: true });
              dispatchApplicationDetailLoaded(data);
            } catch (err) {
              if (detailState.jobId !== jobId) {
                return;
              }
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load application detail';
              setDetailState('error', { message, forceVisible: true });
            } finally {
              if (detailState.jobId === jobId) {
                detailState.loading = false;
              }
            }
          }

          function updatePaginationControls(data) {
            const total = Number.isFinite(data?.total) ? data.total : state.total;
            const offset = Number.isFinite(data?.offset) ? data.offset : state.offset;
            const limit = clampLimit(data?.limit ?? state.limit);
            state.total = Math.max(0, total);
            state.offset = Math.max(0, offset);
            state.limit = limit;

            if (range) {
              if (state.total === 0) {
                range.textContent = 'Showing 0 of 0';
              } else {
                const start = state.offset + 1;
                const end = Math.min(state.offset + state.limit, state.total);
                range.textContent =
                  'Showing ' + start + '-' + end + ' of ' + state.total;
              }
            }

            if (pagination) {
              if (state.total === 0) {
                pagination.setAttribute('hidden', '');
              } else {
                pagination.removeAttribute('hidden');
              }
            }

            if (prevButton) {
              prevButton.disabled = state.offset <= 0;
            }
            if (nextButton) {
              nextButton.disabled = state.offset + state.limit >= state.total;
            }
          }

          async function fetchShortlist(payload) {
            return postCommand('/commands/shortlist-list', payload, {
              invalidResponse: 'Received invalid response while loading shortlist',
              failureMessage: 'Failed to load shortlist',
            });
          }

          async function fetchShortlistDetail(jobId) {
            if (!jobId) {
              throw new Error('Job ID is required');
            }
            return postCommand(
              '/commands/shortlist-show',
              { jobId },
              {
                invalidResponse: 'Received invalid response while loading application detail',
                failureMessage: 'Failed to load application detail',
              },
            );
          }

          async function recordApplicationStatus(jobId, status, note) {
            if (!jobId) {
              throw new Error('Job ID is required');
            }
            if (!status) {
              throw new Error('Status is required');
            }
            const payload = { jobId, status };
            if (note) {
              payload.note = note;
            }
            return postCommand('/commands/track-record', payload, {
              invalidResponse: 'Received invalid response while recording application status',
              failureMessage: 'Failed to record application status',
            });
          }

          async function refresh(options = {}) {
            if (state.loading) {
              return false;
            }

            const useForm = options.useForm === true;
              const filters =
                options.filters ?? (useForm ? readFiltersFromInputs() : state.filters);
              const nextLimit = clampLimit(
                options.limit ?? (useForm ? inputs.limit?.value : state.limit),
              );
              const nextOffset = Math.max(
                0,
                options.offset ?? (options.resetOffset ? 0 : state.offset),
              );

            if (inputs.limit) {
              inputs.limit.value = String(nextLimit);
            }

            const payload = buildRequestPayload(filters || {}, nextOffset, nextLimit);

            state.loading = true;
            setPanelState('applications', 'loading', { preserveMessage: true });

            try {
              const data = await fetchShortlist(payload);
              const items = Array.isArray(data.items) ? data.items : [];
              state.loaded = true;
              state.loading = false;
              state.filters = filters || {};
              state.limit = clampLimit(data.limit ?? nextLimit);
              state.offset = Math.max(0, data.offset ?? nextOffset);
              state.total = Math.max(0, data.total ?? items.length);
              state.lastError = null;
              renderRows(items);
              updatePaginationControls(data);
              setPanelState('applications', 'ready', { preserveMessage: true });
              dispatchApplicationsLoaded(data);
              return true;
            } catch (err) {
              state.loading = false;
              state.lastError = err;
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load shortlist';
              setPanelState('applications', 'error', { message });
              return false;
            }
          }

          function resetFilters() {
            if (inputs.location) inputs.location.value = '';
            if (inputs.level) inputs.level.value = '';
            if (inputs.compensation) inputs.compensation.value = '';
            if (inputs.tags) inputs.tags.value = '';
            if (inputs.limit) inputs.limit.value = String(defaultLimit);
            state.filters = {};
            state.offset = 0;
            state.limit = defaultLimit;
          }

            form?.addEventListener('submit', event => {
              event.preventDefault();
              const filters = readFiltersFromInputs();
              refresh({
                filters,
                offset: 0,
                limit: inputs.limit?.value,
                useForm: true,
                resetOffset: true,
              });
            });

            resetButton?.addEventListener('click', () => {
              resetFilters();
              refresh({
                filters: {},
                offset: 0,
                limit: defaultLimit,
                useForm: false,
                resetOffset: true,
              });
            });

          actionElements?.clear?.addEventListener('click', () => {
            if (actionState.submitting) {
              return;
            }
            resetActionForm();
          });

          actionElements?.form?.addEventListener('submit', async event => {
            event.preventDefault();
            if (actionState.submitting) {
              return;
            }
            const jobId = actionState.jobId;
            if (!jobId) {
              setActionMessage('error', 'Select an application before recording status');
              return;
            }
            const statusValue =
              typeof actionElements.status?.value === 'string'
                ? actionElements.status.value.trim()
                : '';
            if (!statusValue) {
              setActionMessage('error', 'Select a status before saving');
              return;
            }
            const noteValue =
              typeof actionElements.note?.value === 'string'
                ? actionElements.note.value.trim()
                : '';
            try {
              updateActionControls({ submitting: true });
              setActionMessage('info', 'Saving status…');
              const data = await recordApplicationStatus(
                jobId,
                statusValue,
                noteValue || undefined,
              );
              const fallbackMessage =
                'Recorded ' + jobId + ' as ' + formatStatusLabelText(statusValue);
              const message =
                data && typeof data.message === 'string' && data.message.trim()
                  ? data.message.trim()
                  : fallbackMessage;
              setActionMessage('success', message);
              dispatchApplicationStatusRecorded({
                jobId,
                status: statusValue,
                note: noteValue || undefined,
                data,
              });
              resetActionForm({ preserveMessage: true });
            } catch (err) {
              const message =
                err && typeof err.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : 'Unable to record application status';
              setActionMessage('error', message);
            } finally {
              updateActionControls({ submitting: false });
            }
          });

          prevButton?.addEventListener('click', () => {
            const nextOffset = Math.max(0, state.offset - state.limit);
            refresh({ offset: nextOffset });
          });

          nextButton?.addEventListener('click', () => {
            const nextOffset = state.offset + state.limit;
            refresh({ offset: nextOffset });
          });

          tbody?.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
              return;
            }
            const button = target.closest('[data-shortlist-view]');
            if (!button) {
              return;
            }
            const jobId = button.getAttribute('data-shortlist-view');
            if (!jobId) {
              return;
            }
            event.preventDefault();
            loadDetail(jobId);
          });

          setDetailState('empty');

          addRouteListener('applications', () => {
            if (!state.loaded && !state.loading) {
              const filters = readFiltersFromInputs();
              state.filters = filters;
              refresh({ filters, offset: 0, limit: inputs.limit?.value, resetOffset: true });
            }
          });

          scheduleApplicationsReady({ available: true });

          return {
            refresh,
            getState() {
              return {
                ...state,
                filters: { ...state.filters },
              };
            },
          };
        }

        function setupAnalyticsView() {
          const section = document.querySelector('[data-route="analytics"]');
          if (!section) {
            return null;
          }

          const totalsEl = section.querySelector('[data-analytics-totals]');
          const dropoffEl = section.querySelector('[data-analytics-dropoff]');
          const missingEl = section.querySelector('[data-analytics-missing]');
          const table = section.querySelector('[data-analytics-table]');
          const rowsContainer = section.querySelector('[data-analytics-rows]');
          const emptyEl = section.querySelector('[data-analytics-empty]');
          const sankeyEl = section.querySelector('[data-analytics-sankey]');

          const state = { loading: false, loaded: false, data: null, lastError: null };

          function formatConversion(rate) {
            if (!Number.isFinite(rate)) {
              return 'n/a';
            }
            const percent = Math.round(rate * 100);
            return String(percent) + '%';
          }

          function render(data) {
            state.data = data;
            const tracked = Number.isFinite(data?.totals?.trackedJobs)
              ? data.totals.trackedJobs
              : 0;
            const withEvents = Number.isFinite(data?.totals?.withEvents)
              ? data.totals.withEvents
              : 0;
            if (totalsEl) {
              totalsEl.textContent =
                'Tracked jobs: ' + tracked + ' • Outreach events: ' + withEvents;
            }

            if (dropoffEl) {
              const drop = Number.isFinite(data?.largestDropOff?.dropOff)
                ? data.largestDropOff.dropOff
                : 0;
              if (drop > 0 && data?.largestDropOff?.fromLabel && data?.largestDropOff?.toLabel) {
                dropoffEl.textContent =
                  'Largest drop-off: ' +
                  data.largestDropOff.fromLabel +
                  ' → ' +
                  data.largestDropOff.toLabel +
                  ' (' +
                  drop +
                  ')';
              } else {
                dropoffEl.textContent = 'Largest drop-off: none';
              }
            }

            if (missingEl) {
              const count = Number.isFinite(data?.missing?.statuslessJobs?.count)
                ? data.missing.statuslessJobs.count
                : 0;
              if (count > 0) {
                const noun = count === 1 ? 'job' : 'jobs';
                missingEl.textContent =
                  String(count) + ' ' + noun + ' with outreach but no status recorded';
                missingEl.removeAttribute('hidden');
              } else {
                missingEl.textContent = '';
                missingEl.setAttribute('hidden', '');
              }
            }

            const stages = Array.isArray(data?.stages) ? data.stages : [];
            if (rowsContainer) {
              rowsContainer.textContent = '';
              if (stages.length === 0) {
                table?.setAttribute('hidden', '');
                if (emptyEl) emptyEl.removeAttribute('hidden');
              } else {
                table?.removeAttribute('hidden');
                if (emptyEl) emptyEl.setAttribute('hidden', '');
                const fragment = document.createDocumentFragment();
                for (const stage of stages) {
                  const row = document.createElement('tr');
                  const stageCell = document.createElement('th');
                  stageCell.scope = 'row';
                  stageCell.textContent =
                    typeof stage?.label === 'string' && stage.label.trim()
                      ? stage.label.trim()
                      : typeof stage?.key === 'string' && stage.key.trim()
                        ? stage.key.trim()
                        : 'Stage';
                  row.appendChild(stageCell);

                  const countCell = document.createElement('td');
                  const count = Number.isFinite(stage?.count) ? stage.count : 0;
                  countCell.textContent = String(count);
                  row.appendChild(countCell);

                  const conversionCell = document.createElement('td');
                  conversionCell.textContent = formatConversion(stage?.conversionRate);
                  row.appendChild(conversionCell);

                  const dropCell = document.createElement('td');
                  const dropOff = Number.isFinite(stage?.dropOff) ? stage.dropOff : 0;
                  dropCell.textContent = String(dropOff);
                  row.appendChild(dropCell);

                  fragment.appendChild(row);
                }
                rowsContainer.appendChild(fragment);
              }
            }

            if (sankeyEl) {
              const nodes = Array.isArray(data?.sankey?.nodes) ? data.sankey.nodes : [];
              const links = Array.isArray(data?.sankey?.links) ? data.sankey.links : [];
              const dropEdges = links.filter(link => link && link.drop).length;
              if (nodes.length > 0 || links.length > 0) {
                sankeyEl.textContent =
                  'Sankey summary: ' +
                  nodes.length +
                  ' nodes • ' +
                  links.length +
                  ' links (drop-off edges: ' +
                  dropEdges +
                  ')';
                sankeyEl.removeAttribute('hidden');
              } else {
                sankeyEl.textContent = '';
                sankeyEl.setAttribute('hidden', '');
              }
            }
          }

          async function refresh() {
            if (state.loading) {
              return false;
            }
            state.loading = true;
            setPanelState('analytics', 'loading', { preserveMessage: true });

            try {
              const data = await postCommand(
                '/commands/analytics-funnel',
                {},
                {
                  invalidResponse: 'Received invalid response while loading analytics',
                  failureMessage: 'Failed to load analytics',
                },
              );
              state.loading = false;
              state.loaded = true;
              state.lastError = null;
              render(data);
              setPanelState('analytics', 'ready', { preserveMessage: true });
              dispatchAnalyticsLoaded(data);
              return true;
            } catch (err) {
              state.loading = false;
              state.lastError = err;
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load analytics';
              setPanelState('analytics', 'error', { message });
              return false;
            }
          }

          addRouteListener('analytics', () => {
            if (!state.loaded && !state.loading) {
              refresh();
            }
          });

          scheduleAnalyticsReady({ available: true });

          return {
            refresh,
            getState() {
              return { ...state };
            },
          };
        }
        const prefersDark =
          typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        function updateToggle(theme) {
          if (!toggle) return;
          const isLight = theme === 'light';
          toggle.setAttribute('aria-pressed', isLight ? 'true' : 'false');
          const labelText = isLight ? 'Enable dark theme' : 'Enable light theme';
          if (label) {
            label.textContent = labelText;
          }
          toggle.setAttribute('title', labelText);
          toggle.setAttribute('aria-label', labelText);
        }

        function applyTheme(theme, options = {}) {
          const normalized = theme === 'light' ? 'light' : 'dark';
          root.setAttribute('data-theme', normalized);
          updateToggle(normalized);
          if (options.persist) {
            try {
              localStorage.setItem(themeStorageKey, normalized);
            } catch {
              // Ignore storage failures (for example, private browsing)
            }
          }
        }

        function readStoredTheme() {
          try {
            const value = localStorage.getItem(themeStorageKey);
            if (value === 'light' || value === 'dark') {
              return value;
            }
          } catch {
            return null;
          }
          return null;
        }

        function resolveInitialTheme() {
          const stored = readStoredTheme();
          if (stored) {
            return stored;
          }
          if (prefersDark?.matches === false) {
            return 'light';
          }
          return 'dark';
        }

        applyTheme(resolveInitialTheme());

        toggle?.addEventListener('click', () => {
          const currentTheme = root.getAttribute('data-theme');
          const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
          applyTheme(nextTheme, { persist: true });
        });

        prefersDark?.addEventListener('change', event => {
          if (readStoredTheme()) {
            return;
          }
          applyTheme(event.matches ? 'dark' : 'light');
        });

        function normalizeRoute(value) {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim().toLowerCase();
          return routeNames.has(trimmed) ? trimmed : null;
        }

        function addRouteListener(route, handler) {
          const normalized = normalizeRoute(route);
          if (!normalized || typeof handler !== 'function') {
            return;
          }
          if (!routeListeners.has(normalized)) {
            routeListeners.set(normalized, new Set());
          }
          routeListeners.get(normalized).add(handler);
        }

        function notifyRouteListeners(route) {
          const listeners = routeListeners.get(route);
          if (!listeners) {
            return;
          }
          for (const listener of listeners) {
            try {
              listener(route);
            } catch {
              // Ignore listener failures so navigation remains responsive.
            }
          }
        }

        function dispatchRouteChanged(route) {
          dispatchDocumentEvent('jobbot:route-changed', { route });
        }

        const defaultRoute = routeSections[0]?.getAttribute('data-route') ?? null;

        function readStoredRoute() {
          try {
            const value = localStorage.getItem(routeStorageKey);
            return normalizeRoute(value);
          } catch {
            return null;
          }
        }

        function writeStoredRoute(route) {
          try {
            localStorage.setItem(routeStorageKey, route);
          } catch {
            // Ignore storage failures (for example, private browsing)
          }
        }

        function applyRoute(route, options = {}) {
          const normalized = normalizeRoute(route) ?? defaultRoute;
          if (!normalized) {
            return;
          }

          router?.setAttribute('data-active-route', normalized);

          for (const section of routeSections) {
            const sectionRoute = section.getAttribute('data-route');
            if (sectionRoute === normalized) {
              section.removeAttribute('hidden');
              section.setAttribute('data-active', 'true');
            } else {
              section.setAttribute('hidden', '');
              section.removeAttribute('data-active');
            }
          }

          for (const link of navLinks) {
            const target = normalizeRoute(link.getAttribute('data-route-link'));
            if (target === normalized) {
              link.setAttribute('aria-current', 'page');
            } else {
              link.removeAttribute('aria-current');
            }
          }

          notifyRouteListeners(normalized);
          dispatchRouteChanged(normalized);

          if (options.persist) {
            writeStoredRoute(normalized);
          }

          if (options.syncHash) {
            const nextHash = '#' + normalized;
            if (window.location.hash !== nextHash) {
              window.location.hash = nextHash;
              return;
            }
          }
        }

        function routeFromHash() {
          if (!window.location.hash) {
            return null;
          }
          return normalizeRoute(window.location.hash.slice(1));
        }

        function handleHashChange() {
          const fromHash = routeFromHash();
          if (!fromHash) {
            return;
          }
          applyRoute(fromHash, { persist: true });
        }

        const initialRoute = routeFromHash() ?? readStoredRoute() ?? defaultRoute;
        if (initialRoute) {
          applyRoute(initialRoute, { persist: true, syncHash: true });
        }

        window.addEventListener('hashchange', handleHashChange);

        for (const link of navLinks) {
          link.addEventListener('click', event => {
            const targetRoute = normalizeRoute(link.getAttribute('data-route-link'));
            if (!targetRoute) {
              return;
            }
            event.preventDefault();
            applyRoute(targetRoute, { persist: true, syncHash: true });
          });
        }

        initializeStatusPanels();

        const shortlistApi = setupShortlistView();
        if (!shortlistApi) {
          scheduleApplicationsReady({ available: false });
        }

        const analyticsApi = setupAnalyticsView();
        if (!analyticsApi) {
          scheduleAnalyticsReady({ available: false });
        }

        const jobbotStatusApi = {
          setPanelState(id, state, options) {
            return setPanelState(id, state, options ?? {});
          },
          getPanelState(id) {
            return getPanelState(id);
          },
          listPanels() {
            return listStatusPanelIds();
          },
          refreshApplications(options) {
            return shortlistApi ? shortlistApi.refresh(options ?? {}) : false;
          },
          getApplicationsState() {
            return shortlistApi ? shortlistApi.getState() : null;
          },
          refreshAnalytics() {
            return analyticsApi ? analyticsApi.refresh() : false;
          },
          getAnalyticsState() {
            return analyticsApi ? analyticsApi.getState() : null;
          },
        };

        window.JobbotStatusHub = jobbotStatusApi;

        function dispatchDocumentEvent(name, detail, options = {}) {
          const { bubbles = false, cancelable = false } = options;
          try {
            document.dispatchEvent(new CustomEvent(name, { detail, bubbles, cancelable }));
          } catch {
            const fallback = document.createEvent('Event');
            fallback.initEvent(name, bubbles, cancelable);
            if (detail !== undefined) {
              fallback.detail = detail;
            }
            document.dispatchEvent(fallback);
          }
        }

        function dispatchApplicationsReady(detail = {}) {
          dispatchDocumentEvent('jobbot:applications-ready', detail);
        }

        function scheduleApplicationsReady(detail = {}) {
          const emit = () => {
            dispatchApplicationsReady(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchApplicationsLoaded(detail = {}) {
          dispatchDocumentEvent('jobbot:applications-loaded', detail);
        }

        function dispatchAnalyticsReady(detail = {}) {
          dispatchDocumentEvent('jobbot:analytics-ready', detail);
        }

        function scheduleAnalyticsReady(detail = {}) {
          const emit = () => {
            dispatchAnalyticsReady(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchAnalyticsLoaded(detail = {}) {
          dispatchDocumentEvent('jobbot:analytics-loaded', detail);
        }

          function dispatchApplicationDetailLoaded(detail = {}) {
            const jobId =
              typeof detail?.job_id === 'string' && detail.job_id.trim()
                ? detail.job_id.trim()
                : detailState.jobId; // eslint-disable-line no-undef
            const eventDetail = { jobId, data: detail };
            dispatchDocumentEvent('jobbot:application-detail-loaded', eventDetail);
          }

          function dispatchApplicationStatusRecorded(detail = {}) {
            const jobId =
              typeof detail?.jobId === 'string' && detail.jobId.trim()
                ? detail.jobId.trim()
                : detailState.jobId; // eslint-disable-line no-undef
          const eventDetail = {
            jobId,
            status: typeof detail?.status === 'string' ? detail.status : undefined,
            note:
              typeof detail?.note === 'string' && detail.note.trim()
                ? detail.note.trim()
                : undefined,
            data: detail?.data,
          };
          dispatchDocumentEvent('jobbot:application-status-recorded', eventDetail);
        }

        const dispatchRouterReady = () => {
          dispatchDocumentEvent('jobbot:router-ready');
        };

        const dispatchStatusPanelsReady = () => {
          const detail = { panels: listStatusPanelIds() };
          dispatchDocumentEvent('jobbot:status-panels-ready', detail);
        };

        const notifyReady = () => {
          dispatchRouterReady();
          dispatchStatusPanelsReady();
        };

        if (typeof queueMicrotask === 'function') {
          queueMicrotask(notifyReady);
        } else {
          setTimeout(notifyReady, 0);
        }
      })();
