-- Dashboard sign-in attempts, used to limit password guessing. A client is the same daily-salted
-- hash used for visitors (never an IP address); rows older than a day are deleted by the daily cron.
CREATE TABLE sign_in_attempts (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  client TEXT NOT NULL
);
CREATE INDEX sign_in_attempts_client_ts ON sign_in_attempts (client, ts);
CREATE INDEX sign_in_attempts_ts ON sign_in_attempts (ts);
