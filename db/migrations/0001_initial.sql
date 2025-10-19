PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES ('v1');

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  role_hint TEXT,
  contact_email TEXT,
  contact_name TEXT,
  lifecycle_state TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_event_at TEXT,
  subject TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_uid TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(opportunity_uid, email),
  FOREIGN KEY (opportunity_uid) REFERENCES opportunities(uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid TEXT NOT NULL UNIQUE,
  opportunity_uid TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (opportunity_uid) REFERENCES opportunities(uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid TEXT NOT NULL UNIQUE,
  opportunity_uid TEXT,
  actor TEXT,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_uid TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  uri TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (opportunity_uid) REFERENCES opportunities(uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS about (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version TEXT NOT NULL
);

INSERT OR IGNORE INTO about (id, schema_version) VALUES (1, 'v1');
