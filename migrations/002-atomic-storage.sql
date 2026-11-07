-- Reject stale read/modify/write batches before any buffered mutations run.
CREATE TABLE IF NOT EXISTS app_revision (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL, expected INTEGER NOT NULL);
INSERT OR IGNORE INTO app_revision VALUES (1,0,0);
CREATE TRIGGER IF NOT EXISTS app_revision_guard BEFORE UPDATE ON app_revision
WHEN NEW.expected != OLD.value BEGIN SELECT RAISE(ABORT, 'Workspace changed concurrently; retry the operation.'); END;
