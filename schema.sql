CREATE TABLE IF NOT EXISTS incidents (
  id BIGSERIAL PRIMARY KEY,
  case_id VARCHAR(20) UNIQUE NOT NULL,
  category VARCHAR(80) NOT NULL,
  location VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  reporter_id BIGINT,
  confidential_contact_ciphertext TEXT,
  confidential_contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
  confidential_contact_status VARCHAR(30) NOT NULL DEFAULT 'None'
    CHECK (confidential_contact_status IN ('None', 'Available', 'Requested', 'Approved', 'Declined')),
  status VARCHAR(30) NOT NULL DEFAULT 'Filed'
    CHECK (status IN ('Filed', 'Under review', 'Escalated', 'Resolved', 'Ignored', 'Rejected', 'Closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_status_check
  CHECK (status IN ('Filed', 'Under review', 'Escalated', 'Resolved', 'Ignored', 'Rejected', 'Closed'));

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_id BIGINT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS confidential_contact_ciphertext TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS confidential_contact_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS confidential_contact_status VARCHAR(30) NOT NULL DEFAULT 'None'
  CHECK (confidential_contact_status IN ('None', 'Available', 'Requested', 'Approved', 'Declined'));

CREATE TABLE IF NOT EXISTS case_events (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL
    CHECK (status IN ('Filed', 'Under review', 'Escalated', 'Resolved', 'Ignored', 'Rejected', 'Closed')),
  title VARCHAR(120) NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS incidents_case_id_idx ON incidents (case_id);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_reporter_id_idx ON incidents (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS case_events_incident_id_idx ON case_events (incident_id, created_at, id);

CREATE TABLE IF NOT EXISTS evidence (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) UNIQUE NOT NULL,
  storage_backend VARCHAR(20) NOT NULL DEFAULT 'local'
    CHECK (storage_backend IN ('local', 's3')),
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 CHAR(64) NOT NULL,
  security_scan_status VARCHAR(30) NOT NULL DEFAULT 'Not scanned'
    CHECK (security_scan_status IN ('Not scanned', 'Cleared', 'Infected', 'Unavailable')),
  metadata_status VARCHAR(30) NOT NULL DEFAULT 'Not processed'
    CHECK (metadata_status IN ('Not processed', 'Stripped', 'Unavailable')),
  moderation_status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (moderation_status IN ('Pending', 'Approved', 'Rejected', 'Quarantined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evidence_incident_id_idx ON evidence (incident_id, created_at);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(20) NOT NULL DEFAULT 'local'
  CHECK (storage_backend IN ('local', 's3'));
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS security_scan_status VARCHAR(30) NOT NULL DEFAULT 'Not scanned'
  CHECK (security_scan_status IN ('Not scanned', 'Cleared', 'Infected', 'Unavailable'));
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS metadata_status VARCHAR(30) NOT NULL DEFAULT 'Not processed'
  CHECK (metadata_status IN ('Not processed', 'Stripped', 'Unavailable'));

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'public'
    CHECK (role IN ('public', 'lawyer', 'journalist', 'admin')),
  verification_status VARCHAR(30) NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS verification_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_role VARCHAR(30) NOT NULL
    CHECK (requested_role IN ('lawyer', 'journalist')),
  credential_type VARCHAR(40) NOT NULL
    CHECK (credential_type IN ('LSK number', 'Press credential')),
  credential_number VARCHAR(120) NOT NULL,
  organization VARCHAR(180),
  review_status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (review_status IN ('Pending', 'Approved', 'Rejected')),
  review_note TEXT,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS verification_requests_user_id_idx ON verification_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_requests_status_idx ON verification_requests (review_status, created_at);

CREATE TABLE IF NOT EXISTS case_claims (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lawyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active', 'Released')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS case_claims_one_active_idx
  ON case_claims (incident_id)
  WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS case_claims_lawyer_id_idx ON case_claims (lawyer_id, status, claimed_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incidents_reporter_id_fkey'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_reporter_id_fkey
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS case_contact_requests (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lawyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Declined')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS case_contact_requests_pending_idx
  ON case_contact_requests (incident_id)
  WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS case_contact_requests_incident_idx
  ON case_contact_requests (incident_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS sensitive_access_logs (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  accessor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sensitive_access_logs_incident_idx
  ON sensitive_access_logs (incident_id, created_at DESC);

ALTER TABLE sensitive_access_logs ALTER COLUMN accessor_id DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sensitive_access_logs_accessor_id_fkey'
  ) THEN
    ALTER TABLE sensitive_access_logs DROP CONSTRAINT sensitive_access_logs_accessor_id_fkey;
  END IF;
  ALTER TABLE sensitive_access_logs
    ADD CONSTRAINT sensitive_access_logs_accessor_id_fkey
    FOREIGN KEY (accessor_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS case_messages (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sender_role VARCHAR(30) NOT NULL CHECK (sender_role IN ('applicant', 'lawyer', 'admin')),
  sender_name VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS case_messages_incident_idx ON case_messages (incident_id, created_at ASC);


CREATE TABLE IF NOT EXISTS court_briefs (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  lawyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  court_name VARCHAR(180) NOT NULL,
  hearing_type VARCHAR(100) NOT NULL,
  presiding_magistrate VARCHAR(140),
  proceedings_summary TEXT NOT NULL,
  court_orders TEXT,
  next_court_date DATE,
  instructions_to_applicant TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS court_briefs_incident_id_idx ON court_briefs (incident_id, created_at DESC);
