/**
 * @typedef {Object} JobSnapshot
 * @property {string} id Stable identifier for the posting.
 * @property {string} raw Plain text representation of the job content.
 * @property {any} parsed Structured metadata extracted from the job posting.
 * @property {{ type: string, value: string }} source Provider identifier and canonical URL.
 * @property {Record<string, string>} requestHeaders Sanitized headers associated with the fetch.
 * @property {string | undefined} [fetchedAt] When the snapshot was captured.
 */

/**
 * @typedef {Object} JobApplicationEvent
 * @property {string} channel Lifecycle channel for the event (email, call, job_posting, etc.).
 * @property {string | Date | undefined} [date]
 * @property {string | undefined} [note]
 * @property {string | undefined} [contact]
 * @property {string[] | undefined} [documents]
 * @property {string | Date | undefined} [remindAt]
 */

/**
 * @typedef {Object} JobSourceAdapter
 * @property {string} provider Stable provider slug (e.g., greenhouse, lever).
 * @property {(options: Record<string, any>) => Promise<{
 *   jobs: any[],
 *   context: Record<string, any>,
 * }>} listOpenings
 * Fetch the latest postings for a provider. Returns the raw jobs plus any context required
 * for downstream normalization (board slug, rate limit keys, headers, etc.).
 * @property {(job: any, context: Record<string, any>) => Promise<JobSnapshot> | JobSnapshot}
 * normalizeJob
 * Convert a provider-specific job payload into a {@link JobSnapshot} ready for persistence.
 * @property {(job: any, context: Record<string, any>) => JobApplicationEvent | null | undefined}
 * toApplicationEvent
 * Optional hook that emits an application event representing the sync.
 */

export const JOB_SOURCE_ADAPTER_VERSION = 1;

/**
 * Coerce arbitrary header values into a stable {string: string} record suitable for JSON storage.
 *
 * @param {Record<string, any> | undefined} headers
 * @returns {Record<string, string>}
 */
export function sanitizeSnapshotHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    normalized[key] = String(value);
  }
  return normalized;
}
