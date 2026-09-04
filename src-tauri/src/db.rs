use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection};

use crate::error::CommandError;
use crate::models::{AppSettings, TimerMode, TimerSnapshot};

/// Bump this whenever a new migration is appended to `MIGRATIONS`.
const LATEST_SCHEMA_VERSION: u32 = 1;

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT    NOT NULL,
    done            INTEGER NOT NULL DEFAULT 0,
    pomodoro_target INTEGER NOT NULL DEFAULT 1,
    priority        TEXT    NOT NULL DEFAULT 'med',
    project         TEXT    NOT NULL DEFAULT '通用',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(sort_order);

CREATE TABLE IF NOT EXISTS timer_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    mode                TEXT    NOT NULL,
    state               TEXT    NOT NULL,
    active_session_id   TEXT,
    selected_task_id    TEXT,
    task_title_snapshot TEXT,
    project_snapshot    TEXT,
    duration_seconds    INTEGER NOT NULL CHECK (duration_seconds > 0),
    remaining_seconds   INTEGER NOT NULL CHECK (remaining_seconds >= 0),
    started_at          INTEGER,
    target_end_at       INTEGER,
    paused_at           INTEGER,
    revision            INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    task_id             TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    task_title_snapshot TEXT    NOT NULL,
    project_snapshot    TEXT    NOT NULL,
    mode                TEXT    NOT NULL,
    status              TEXT    NOT NULL,
    planned_seconds     INTEGER NOT NULL,
    focused_seconds     INTEGER NOT NULL,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);

CREATE TABLE IF NOT EXISTS settings (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    focus_duration_minutes INTEGER NOT NULL,
    short_break_minutes    INTEGER NOT NULL,
    long_break_minutes     INTEGER NOT NULL,
    auto_start_break       INTEGER NOT NULL,
    sound_enabled          INTEGER NOT NULL,
    notification_enabled   INTEGER NOT NULL,
    daily_goal             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL
);
"#;

/// Opens a migrated, seeded in-memory database. Used by tests.
pub fn open_in_memory() -> Result<Connection, CommandError> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn, false)?;
    run_migrations(&mut conn)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

/// Opens (or creates) the on-disk database, creating parent directories as needed.
///
/// Defensive against a corrupt on-disk database (P0: the app must still start):
/// if the file cannot be opened/migrated/seeded, or fails `PRAGMA integrity_check`,
/// it is renamed aside with a `.corrupt-<timestamp>` suffix (preserved for manual
/// recovery) and a fresh database is created in its place. The corrupt file is
/// never silently discarded.
pub fn open_at(path: &Path) -> Result<Connection, CommandError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CommandError::internal(format!(
                    "failed to create database directory {}: {err}",
                    parent.display()
                ))
            })?;
        }
    }

    match try_open_at(path) {
        Ok(conn) if is_healthy(&conn) => Ok(conn),
        Ok(conn) => {
            // Opened but failed the integrity check — recover from a renamed copy.
            drop(conn);
            recover_corrupt(path)?;
            try_open_at(path)
        }
        Err(_) => {
            // Could not open/migrate/seed — recover from a renamed copy.
            recover_corrupt(path)?;
            try_open_at(path)
        }
    }
}

/// Opens, configures, migrates and seeds a database. Any failure here signals
/// either an unreadable file or a schema problem, both of which `open_at`
/// resolves by renaming the file aside and starting fresh.
fn try_open_at(path: &Path) -> Result<Connection, CommandError> {
    let mut conn = Connection::open(path)?;
    configure(&conn, true)?;
    run_migrations(&mut conn)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

/// A healthy database reports exactly "ok" from `PRAGMA integrity_check`.
fn is_healthy(conn: &Connection) -> bool {
    conn.pragma_query_value(None, "integrity_check", |row| row.get::<_, String>(0))
        .map(|v| v.eq_ignore_ascii_case("ok"))
        .unwrap_or(false)
}

/// Renames a possibly-corrupt database (and its WAL/SHM siblings) aside with a
/// `.corrupt-<timestamp>` suffix so the user can recover it manually later,
/// then lets a subsequent `try_open_at` create a fresh file at `path`. Rename
/// errors are ignored — if the file is locked we still attempt a fresh open.
fn recover_corrupt(path: &Path) -> Result<(), CommandError> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if base.is_empty() {
        return Ok(());
    }
    let suffix = format!(".corrupt-{ts}");
    for name in [base.clone(), format!("{base}-wal"), format!("{base}-shm")] {
        let candidate = path.with_file_name(&name);
        if candidate.exists() {
            let backup = path.with_file_name(format!("{name}{suffix}"));
            let _ = std::fs::rename(&candidate, &backup);
        }
    }
    Ok(())
}

/// Applies the startup pragmas from the design spec: `foreign_keys = ON`,
/// `busy_timeout = 5000`, plus `journal_mode = WAL` for file-backed databases
/// (in-memory databases cannot use WAL).
fn configure(conn: &Connection, persistent: bool) -> Result<(), CommandError> {
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    if persistent {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> Result<u32, CommandError> {
    let version = conn.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))?;
    Ok(version)
}

/// Applies any outstanding migrations. Safe to call on every launch.
pub fn run_migrations(conn: &mut Connection) -> Result<(), CommandError> {
    let current = schema_version(conn)?;
    if current >= LATEST_SCHEMA_VERSION {
        return Ok(());
    }

    if current < 1 {
        let tx = conn.transaction()?;
        tx.execute_batch(MIGRATION_V1)?;
        tx.pragma_update(None, "user_version", 1u32)?;
        tx.commit()?;
    }

    Ok(())
}

/// Inserts the single settings row and idle timer row if they are missing.
pub fn seed_defaults(conn: &Connection) -> Result<(), CommandError> {
    let settings = AppSettings::default();
    conn.execute(
        "INSERT INTO settings (
            id, focus_duration_minutes, short_break_minutes, long_break_minutes,
            auto_start_break, sound_enabled, notification_enabled, daily_goal, updated_at
         ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO NOTHING",
        params![
            settings.focus_duration_minutes,
            settings.short_break_minutes,
            settings.long_break_minutes,
            settings.auto_start_break as i64,
            settings.sound_enabled as i64,
            settings.notification_enabled as i64,
            settings.daily_goal,
            settings.updated_at,
        ],
    )?;

    let timer = TimerSnapshot::idle(
        TimerMode::Focus,
        settings.duration_seconds_for_mode(TimerMode::Focus),
    );
    conn.execute(
        "INSERT INTO timer_state (
            id, mode, state, active_session_id, selected_task_id,
            task_title_snapshot, project_snapshot, duration_seconds, remaining_seconds,
            started_at, target_end_at, paused_at, revision, updated_at
         ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO NOTHING",
        params![
            timer.mode.as_str(),
            timer.state.as_str(),
            timer.active_session_id,
            timer.selected_task_id,
            timer.task_title_snapshot,
            timer.project_snapshot,
            timer.duration_seconds,
            timer.remaining_seconds,
            timer.started_at,
            timer.target_end_at,
            timer.paused_at,
            timer.revision,
            timer.updated_at,
        ],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .expect("query should prepare");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows should decode")
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .expect("count should run")
    }

    #[test]
    fn migrations_create_every_expected_table() {
        let conn = open_in_memory().expect("database should open");

        let tables = table_names(&conn);

        assert!(tables.contains(&"tasks".to_owned()), "missing tasks: {tables:?}");
        assert!(tables.contains(&"timer_state".to_owned()), "missing timer_state: {tables:?}");
        assert!(tables.contains(&"sessions".to_owned()), "missing sessions: {tables:?}");
        assert!(tables.contains(&"settings".to_owned()), "missing settings: {tables:?}");
        assert_eq!(schema_version(&conn).unwrap(), LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = open_in_memory().expect("database should open");

        run_migrations(&mut conn).expect("re-running migrations should be a no-op");
        run_migrations(&mut conn).expect("re-running migrations should be a no-op");

        assert_eq!(schema_version(&conn).unwrap(), LATEST_SCHEMA_VERSION);
        assert_eq!(table_names(&conn).len(), 4);
    }

    #[test]
    fn seed_defaults_inserts_a_single_settings_and_timer_row() {
        let conn = open_in_memory().expect("database should open");

        assert_eq!(count(&conn, "settings"), 1);
        assert_eq!(count(&conn, "timer_state"), 1);

        let (focus, short, long, goal, sound, notify) = conn
            .query_row(
                "SELECT focus_duration_minutes, short_break_minutes, long_break_minutes,
                        daily_goal, sound_enabled, notification_enabled
                 FROM settings WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .expect("settings row should exist");
        assert_eq!((focus, short, long, goal, sound, notify), (25, 5, 15, 8, 1, 1));

        let (mode, state, duration, remaining, revision) = conn
            .query_row(
                "SELECT mode, state, duration_seconds, remaining_seconds, revision
                 FROM timer_state WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .expect("timer row should exist");
        assert_eq!(mode, "focus");
        assert_eq!(state, "idle");
        assert_eq!(duration, 1500);
        assert_eq!(remaining, 1500);
        assert_eq!(revision, 0);
    }

    #[test]
    fn seed_defaults_is_idempotent() {
        let conn = open_in_memory().expect("database should open");

        seed_defaults(&conn).expect("re-seeding should be a no-op");
        seed_defaults(&conn).expect("re-seeding should be a no-op");

        assert_eq!(count(&conn, "settings"), 1);
        assert_eq!(count(&conn, "timer_state"), 1);
    }

    #[test]
    fn single_row_tables_reject_a_second_row() {
        let conn = open_in_memory().expect("database should open");

        let result = conn.execute(
            "INSERT INTO settings (id, focus_duration_minutes, short_break_minutes,
                long_break_minutes, auto_start_break, sound_enabled,
                notification_enabled, daily_goal, updated_at)
             VALUES (2, 25, 5, 15, 0, 1, 1, 8, 0)",
            [],
        );

        assert!(result.is_err(), "timer_state/settings must stay single-row");
    }

    #[test]
    fn timer_state_rejects_a_negative_revision() {
        let conn = open_in_memory().expect("database should open");

        let result = conn.execute("UPDATE timer_state SET revision = -1 WHERE id = 1", []);

        assert!(result.is_err(), "revision must stay >= 0");
    }

    #[test]
    fn timer_state_rejects_a_non_positive_duration() {
        let conn = open_in_memory().expect("database should open");

        assert!(
            conn.execute("UPDATE timer_state SET duration_seconds = 0 WHERE id = 1", [])
                .is_err(),
            "duration_seconds must stay > 0"
        );
        assert!(
            conn.execute("UPDATE timer_state SET duration_seconds = -5 WHERE id = 1", [])
                .is_err(),
            "duration_seconds must stay > 0"
        );
    }

    #[test]
    fn timer_state_rejects_negative_remaining_seconds() {
        let conn = open_in_memory().expect("database should open");

        let result = conn.execute("UPDATE timer_state SET remaining_seconds = -1 WHERE id = 1", []);

        assert!(result.is_err(), "remaining_seconds must stay >= 0");
    }

    #[test]
    fn deleting_a_task_preserves_its_session_with_a_null_task_id() {
        let conn = open_in_memory().expect("database should open");

        conn.execute(
            "INSERT INTO tasks (id, title, done, pomodoro_target, priority, project,
                                sort_order, created_at, updated_at, completed_at)
             VALUES ('task-1', 'Deep work', 0, 4, 'high', 'Abyssal', 0, 1, 1, NULL)",
            [],
        )
        .expect("task should insert");
        conn.execute(
            "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                                   status, planned_seconds, focused_seconds, started_at, ended_at)
             VALUES ('session-1', 'task-1', 'Deep work', 'Abyssal', 'focus', 'completed',
                     1500, 1500, 1, 1501)",
            [],
        )
        .expect("session should insert");

        conn.execute("DELETE FROM tasks WHERE id = 'task-1'", [])
            .expect("task should delete");

        let (task_id, title) = conn
            .query_row(
                "SELECT task_id, task_title_snapshot FROM sessions WHERE id = 'session-1'",
                [],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("session should survive");

        assert_eq!(task_id, None, "foreign key should null out on delete");
        assert_eq!(title, "Deep work", "snapshots must survive task deletion");
    }

    #[test]
    fn corrupt_database_is_recovered_by_reseeding() {
        let dir = std::env::temp_dir().join(format!(
            "abyssal-recover-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("dir");
        let db_path = dir.join("abyssal-reverie.sqlite");
        // Garbage bytes that are not a valid SQLite database.
        std::fs::write(&db_path, b"not a sqlite database at all\x00\x01\x02")
            .expect("write garbage");

        let conn = open_at(&db_path).expect("open_at should recover from corruption");

        // Fresh, healthy database: default settings + idle timer present.
        let (focus, goal) = conn
            .query_row(
                "SELECT focus_duration_minutes, daily_goal FROM settings WHERE id = 1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .expect("settings should exist");
        assert_eq!(focus, 25);
        assert_eq!(goal, 8);
        assert!(is_healthy(&conn), "recovered database must be healthy");

        // The corrupt file was preserved with a `.corrupt-` suffix for manual recovery.
        let preserved = std::fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(preserved, "corrupt file must be preserved for manual recovery");

        // Cleanup.
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_database_is_created_and_seeded_on_first_open() {
        let dir = std::env::temp_dir().join(format!(
            "abyssal-empty-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("dir");
        let db_path = dir.join("abyssal-reverie.sqlite");

        let conn = open_at(&db_path).expect("open_at should create a fresh database");
        assert!(is_healthy(&conn));
        assert_eq!(count(&conn, "settings"), 1);
        assert_eq!(count(&conn, "timer_state"), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
