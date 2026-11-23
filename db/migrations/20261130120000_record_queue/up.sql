-- The record of an issue made in the app (#111, `03` row 11): its row in the Registr and its
-- Evidence, written by the app and read by nobody. The database is written first; the sheet
-- follows from the marks below, rewritten whole each time, so a sheet that does not answer only
-- delays the record.
--
-- Times are UTC instants as ISO 8601 text with milliseconds, as everywhere in the schema.

-- The issue's Evidence, created by the queue in the issue folder and found again by the key on
-- the file, never by its name. NULL until it exists.
ALTER TABLE issues ADD COLUMN evidence_spreadsheet_id TEXT;

-- One record that is out of date: `registry`, the app's list in the Registr (`issue_id` 0), or
-- `evidence`, one issue's Evidence. Every change the record shows bumps `generation` in the same
-- transaction as the change, through the triggers below, so no action can forget to mark and a
-- rolled-back action marks nothing. A write removes the mark only while `generation` is the one
-- it read: a change made during the write is written on the next pass.
CREATE TABLE record_marks (
  kind TEXT NOT NULL CHECK (kind IN ('registry', 'evidence')),
  issue_id INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1,
  -- The failed writes since the last change, and when the next one may be tried.
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at TEXT,
  last_error TEXT,
  PRIMARY KEY (kind, issue_id),
  CHECK ((kind = 'registry') = (issue_id = 0))
) STRICT;

-- When every record was last marked for the daily rewrite (`03` row 11). NULL marks them all on
-- the first pass, which is how the issues made before this migration get their record.
CREATE TABLE record_rewrites (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_full_at TEXT
) STRICT;

INSERT INTO record_rewrites (id, last_full_at) VALUES (1, NULL);

-- The triggers fire on the columns a record shows and on nothing else, so a job that touches a
-- row on every run (`claim_key`, `checked_at`) does not rewrite a sheet. A column the record
-- starts to show needs its trigger changed in a new migration.

-- The Registr row: the issue's name, folders, Evidence and state. A complete issue only.
CREATE TRIGGER record_issue_registry
AFTER UPDATE OF name, folder_id, completed_at, closed_at, evidence_spreadsheet_id, started_at
ON issues
WHEN NEW.completed_at IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('registry', 0)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- The Evidence comes into being once the issue is complete.
CREATE TRIGGER record_issue_evidence
AFTER UPDATE OF completed_at ON issues
WHEN NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('evidence', NEW.id)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- The Registr's URL – Vytvořit článek: a new link or a revoked one.
CREATE TRIGGER record_link_inserted
AFTER INSERT ON links
WHEN NEW.kind = 'article'
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('registry', 0)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

CREATE TRIGGER record_link_revoked
AFTER UPDATE OF revoked_at ON links
WHEN NEW.kind = 'article'
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('registry', 0)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- Články: a created article, its name, files, handover and proofreading.
CREATE TRIGGER record_article
AFTER UPDATE OF name, created_at, doc_id, folder_id, licences_folder_id, handed_over_at,
  handover_cancelled_at, proofread_at, proofread_by_email, proofread_by_name,
  proofreading_cancelled_at
ON articles
WHEN NEW.created_at IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('evidence', NEW.issue_id)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- Autoři, and the author of each clause.
CREATE TRIGGER record_author_inserted
AFTER INSERT ON article_authors
WHEN (SELECT created_at FROM articles WHERE id = NEW.article_id) IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

CREATE TRIGGER record_author_changed
AFTER UPDATE OF name, email, position ON article_authors
WHEN (SELECT created_at FROM articles WHERE id = NEW.article_id) IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- K finalizaci – kdy, and the clauses of a marking: made, cancelled or replaced.
CREATE TRIGGER record_final_version_inserted
AFTER INSERT ON final_versions
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

CREATE TRIGGER record_final_version_changed
AFTER UPDATE OF cancelled_at, replaced_at, pdf_file_id, pdf_hash, marked_at ON final_versions
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- Redakční doložky: one clause, its sending, its reply and its archive.
CREATE TRIGGER record_clause_inserted
AFTER INSERT ON article_clauses
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

CREATE TRIGGER record_clause_changed
AFTER UPDATE OF author_name, author_email, state, clause_key, sent_at, error, reply_thread_id,
  reply_message_id, reply_received_at, is_exact_consent, consent_verified_at, approved_at,
  archive_failed_at, archive_error
ON article_clauses
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- Obrazová díla: a committed batch, its request, its reply and its archive, or its discarding.
CREATE TRIGGER record_batch
AFTER UPDATE OF created_at, discarded_at, provider_name, provider_email, mail_sent_at,
  mail_failed_at, mail_refused_at, reply_thread_id, reply_message_id, reply_received_at,
  is_exact_consent, consent_verified_at, approved_at, archive_failed_at, archive_error
ON artwork_batches
WHEN NEW.created_at IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id) VALUES ('evidence', NEW.issue_id)
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;

-- An artwork's Autor, Zdroj and Dílo, once it is in a batch.
CREATE TRIGGER record_artwork
AFTER UPDATE OF batch_id, position, author, source, stored_name, removed_at ON artworks
WHEN NEW.batch_id IS NOT NULL
BEGIN
  INSERT INTO record_marks (kind, issue_id)
  VALUES ('evidence', (SELECT issue_id FROM articles WHERE id = NEW.article_id))
  ON CONFLICT (kind, issue_id) DO UPDATE
    SET generation = generation + 1, attempts = 0, retry_at = NULL, last_error = NULL;
END;
