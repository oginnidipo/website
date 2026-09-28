-- One row per page view, action, or engaged-time report. No IP addresses or cookies are stored.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  label TEXT,
  target TEXT,
  seconds INTEGER,
  source TEXT,
  referrer TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  org TEXT,
  asn INTEGER,
  device TEXT,
  browser TEXT,
  os TEXT,
  lang TEXT
);
CREATE INDEX events_ts ON events (ts);
CREATE INDEX events_visitor_ts ON events (visitor, ts);

-- One random salt per UTC day for visitor hashes. Past days are deleted by the daily cron,
-- after which a hash can no longer be linked to an IP address.
CREATE TABLE salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
