use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::error::CommandError;
use crate::models::{
    AppSettings, CompleteTimerInput, CompleteTimerResult, CreateTaskInput, DayStat, ProjectStat,
    SaveSettingsResult, SessionQuery, SessionStatus, StartTimerInput, Statistics,
    StatisticsQuery, SwitchTimerModeInput, Task, TaskPriority, TimerMode,
    TimerSession, TimerSnapshot, TimerState, UpdateTaskInput,
};

// ─── Fixed snapshot labels (design spec §3) ──────────────────────────────────
pub const NO_TASK_TITLE: &str = "未指定任务";
pub const NO_TASK_PROJECT: &str = "通用";
pub const SHORT_BREAK_TITLE: &str = "短休";
pub const LONG_BREAK_TITLE: &str = "长休";
pub const BREAK_PROJECT: &str = "休息";

pub const MIN_POMODORO_TARGET: i64 = 1;
pub const MAX_POMODORO_TARGET: i64 = 99;
pub const MAX_TITLE_CHARS: usize = 200;
pub const DEFAULT_PROJECT: &str = "通用";

pub const MIN_DURATION_MINUTES: i64 = 1;
pub const MAX_DURATION_MINUTES: i64 = 180;
pub const MIN_DAILY_GOAL: i64 = 1;
pub const MAX_DAILY_GOAL: i64 = 50;

const TASK_COLUMNS: &str = "id, title, done, pomodoro_target, priority, project, sort_order, \
                            created_at, updated_at, completed_at";
const SESSION_COLUMNS: &str = "id, task_id, task_title_snapshot, project_snapshot, mode, status, \
                               planned_seconds, focused_seconds, started_at, ended_at";

pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn clean_title(raw: &str) -> String {
    raw.trim().chars().take(MAX_TITLE_CHARS).collect()
}

fn clean_project(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        DEFAULT_PROJECT.to_owned()
    } else {
        trimmed.to_owned()
    }
}

pub fn validate_title(raw: &str) -> Result<(), CommandError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandError::validation("title must not be empty"));
    }
    if trimmed.chars().count() > MAX_TITLE_CHARS {
        return Err(CommandError::validation(format!(
            "title must be at most {MAX_TITLE_CHARS} characters"
        )));
    }
    Ok(())
}

pub fn validate_pomodoro_target(target: i64) -> Result<(), CommandError> {
    if (MIN_POMODORO_TARGET..=MAX_POMODORO_TARGET).contains(&target) {
        Ok(())
    } else {
        Err(CommandError::validation(format!(
            "pomodoroTarget must be between {MIN_POMODORO_TARGET} and {MAX_POMODORO_TARGET}"
        )))
    }
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<Task> {
    let priority_text: String = row.get("priority")?;
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        done: row.get::<_, i64>("done")? != 0,
        pomodoro_target: row.get("pomodoro_target")?,
        priority: TaskPriority::parse_str(&priority_text).unwrap_or(TaskPriority::Med),
        project: row.get("project")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn session_from_row(row: &Row<'_>) -> rusqlite::Result<TimerSession> {
    let mode_text: String = row.get("mode")?;
    let status_text: String = row.get("status")?;
    Ok(TimerSession {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        task_title_snapshot: row.get("task_title_snapshot")?,
        project_snapshot: row.get("project_snapshot")?,
        mode: TimerMode::parse_str(&mode_text).unwrap_or(TimerMode::Focus),
        status: SessionStatus::parse_str(&status_text).unwrap_or(SessionStatus::Abandoned),
        planned_seconds: row.get("planned_seconds")?,
        focused_seconds: row.get("focused_seconds")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
    })
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>, CommandError> {
    let mut stmt =
        conn.prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY sort_order, created_at"))?;
    let rows = stmt.query_map([], task_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_task(conn: &Connection, id: &str) -> Result<Task, CommandError> {
    conn.query_row(
        &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"),
        params![id],
        task_from_row,
    )
    .optional()?
    .ok_or_else(|| CommandError::not_found(format!("task {id} not found")))
}

pub fn insert_task(conn: &Connection, input: &CreateTaskInput) -> Result<Task, CommandError> {
    validate_title(&input.title)?;
    validate_pomodoro_target(input.pomodoro_target)?;

    let now = now_millis();
    let sort_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM tasks", [], |row| row.get(0))
        .unwrap_or(0);

    let task = Task {
        id: Uuid::new_v4().to_string(),
        title: clean_title(&input.title),
        done: false,
        pomodoro_target: input.pomodoro_target,
        priority: input.priority,
        project: clean_project(&input.project),
        sort_order,
        created_at: now,
        updated_at: now,
        completed_at: None,
    };

    conn.execute(
        "INSERT INTO tasks (id, title, done, pomodoro_target, priority, project, sort_order,
                            created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            task.id,
            task.title,
            task.done as i64,
            task.pomodoro_target,
            task.priority.as_str(),
            task.project,
            task.sort_order,
            task.created_at,
            task.updated_at,
            task.completed_at,
        ],
    )?;

    Ok(task)
}

pub fn update_task(conn: &Connection, input: &UpdateTaskInput) -> Result<Task, CommandError> {
    let mut task = get_task(conn, &input.id)?;

    if let Some(title) = &input.title {
        validate_title(title)?;
        task.title = clean_title(title);
    }
    if let Some(target) = input.pomodoro_target {
        validate_pomodoro_target(target)?;
        task.pomodoro_target = target;
    }
    if let Some(priority) = input.priority {
        task.priority = priority;
    }
    if let Some(project) = &input.project {
        task.project = clean_project(project);
    }
    if let Some(done) = input.done {
        if done != task.done {
            task.done = done;
            task.completed_at = if done { Some(now_millis()) } else { None };
        }
    }

    task.updated_at = now_millis();

    conn.execute(
        "UPDATE tasks SET title = ?1, done = ?2, pomodoro_target = ?3, priority = ?4,
                          project = ?5, updated_at = ?6, completed_at = ?7
         WHERE id = ?8",
        params![
            task.title,
            task.done as i64,
            task.pomodoro_target,
            task.priority.as_str(),
            task.project,
            task.updated_at,
            task.completed_at,
            task.id,
        ],
    )?;

    Ok(task)
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<(), CommandError> {
    let removed = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    if removed == 0 {
        return Err(CommandError::not_found(format!("task {id} not found")));
    }
    Ok(())
}

// ─── Settings, timer and sessions ────────────────────────────────────────────

pub fn get_settings(conn: &Connection) -> Result<AppSettings, CommandError> {
    conn.query_row(
        "SELECT focus_duration_minutes, short_break_minutes, long_break_minutes, auto_start_break,
                sound_enabled, notification_enabled, daily_goal, updated_at
         FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(AppSettings {
                focus_duration_minutes: row.get(0)?,
                short_break_minutes: row.get(1)?,
                long_break_minutes: row.get(2)?,
                auto_start_break: row.get::<_, i64>(3)? != 0,
                sound_enabled: row.get::<_, i64>(4)? != 0,
                notification_enabled: row.get::<_, i64>(5)? != 0,
                daily_goal: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(Into::into)
}

pub fn validate_settings(settings: &AppSettings) -> Result<(), CommandError> {
    let check_range = |value: i64, min: i64, max: i64, name: &str| {
        if (min..=max).contains(&value) {
            Ok(())
        } else {
            Err(CommandError::validation(format!(
                "{name} must be between {min} and {max}"
            )))
        }
    };

    check_range(
        settings.focus_duration_minutes,
        MIN_DURATION_MINUTES,
        MAX_DURATION_MINUTES,
        "focusDurationMinutes",
    )?;
    check_range(
        settings.short_break_minutes,
        MIN_DURATION_MINUTES,
        MAX_DURATION_MINUTES,
        "shortBreakMinutes",
    )?;
    check_range(
        settings.long_break_minutes,
        MIN_DURATION_MINUTES,
        MAX_DURATION_MINUTES,
        "longBreakMinutes",
    )?;
    check_range(
        settings.daily_goal,
        MIN_DAILY_GOAL,
        MAX_DAILY_GOAL,
        "dailyGoal",
    )?;
    Ok(())
}

/// Persists settings and returns the updated settings plus a refreshed timer.
///
/// If the timer is idle, its `durationSeconds` / `remainingSeconds` are
/// recalculated from the new durations so the UI immediately reflects the
/// change. A running or paused timer is left untouched — the new durations
/// take effect on the next session.
pub fn save_settings(
    conn: &Connection,
    settings: &AppSettings,
) -> Result<SaveSettingsResult, CommandError> {
    validate_settings(settings)?;

    let now = now_millis();
    conn.execute(
        "UPDATE settings SET focus_duration_minutes = ?1, short_break_minutes = ?2,
                              long_break_minutes = ?3, auto_start_break = ?4,
                              sound_enabled = ?5, notification_enabled = ?6,
                              daily_goal = ?7, updated_at = ?8
         WHERE id = 1",
        params![
            settings.focus_duration_minutes,
            settings.short_break_minutes,
            settings.long_break_minutes,
            settings.auto_start_break as i64,
            settings.sound_enabled as i64,
            settings.notification_enabled as i64,
            settings.daily_goal,
            now,
        ],
    )?;

    let mut timer = get_timer(conn)?;
    if timer.state == TimerState::Idle {
        let new_duration = settings.duration_seconds_for_mode(timer.mode);
        timer.duration_seconds = new_duration;
        timer.remaining_seconds = new_duration;
        timer.updated_at = now;
        write_timer(conn, &timer)?;
    }

    let persisted = get_settings(conn)?;
    Ok(SaveSettingsResult {
        settings: persisted,
        timer,
    })
}

fn write_timer(conn: &Connection, timer: &TimerSnapshot) -> Result<(), CommandError> {
    conn.execute(
        "UPDATE timer_state SET mode = ?1, state = ?2, active_session_id = ?3,
                                selected_task_id = ?4, task_title_snapshot = ?5,
                                project_snapshot = ?6, duration_seconds = ?7,
                                remaining_seconds = ?8, started_at = ?9, target_end_at = ?10,
                                paused_at = ?11, revision = ?12, updated_at = ?13
         WHERE id = 1",
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

pub fn get_timer(conn: &Connection) -> Result<TimerSnapshot, CommandError> {
    conn.query_row(
        "SELECT mode, state, active_session_id, selected_task_id, task_title_snapshot,
                project_snapshot, duration_seconds, remaining_seconds, started_at, target_end_at,
                paused_at, revision, updated_at
         FROM timer_state WHERE id = 1",
        [],
        |row| {
            let mode_text: String = row.get(0)?;
            let state_text: String = row.get(1)?;
            Ok(TimerSnapshot {
                mode: TimerMode::parse_str(&mode_text).unwrap_or(TimerMode::Focus),
                state: TimerState::parse_str(&state_text).unwrap_or(TimerState::Idle),
                active_session_id: row.get(2)?,
                selected_task_id: row.get(3)?,
                task_title_snapshot: row.get(4)?,
                project_snapshot: row.get(5)?,
                duration_seconds: row.get(6)?,
                remaining_seconds: row.get(7)?,
                started_at: row.get(8)?,
                target_end_at: row.get(9)?,
                paused_at: row.get(10)?,
                revision: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
    .map_err(Into::into)
}

pub fn list_sessions(conn: &Connection, limit: i64) -> Result<Vec<TimerSession>, CommandError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS} FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map(params![limit], session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ─── Timer state machine (design spec §4) ────────────────────────────────────

/// Computes the snapshot title/project for a timer start, per spec §3.
fn snapshot_for_mode(mode: TimerMode, task: Option<&Task>) -> (String, String) {
    match mode {
        TimerMode::Focus => {
            if let Some(t) = task {
                (t.title.clone(), t.project.clone())
            } else {
                (NO_TASK_TITLE.to_owned(), NO_TASK_PROJECT.to_owned())
            }
        }
        TimerMode::Short => (SHORT_BREAK_TITLE.to_owned(), BREAK_PROJECT.to_owned()),
        TimerMode::Long => (LONG_BREAK_TITLE.to_owned(), BREAK_PROJECT.to_owned()),
    }
}

/// Live remaining seconds for a running timer, derived from `target_end_at`.
fn live_remaining(timer: &TimerSnapshot, now: i64) -> i64 {
    match timer.target_end_at {
        Some(end) => ((end - now) / 1000).max(0),
        None => timer.remaining_seconds,
    }
}

/// Writes an abandoned session for a timer that was started but not completed.
/// Uses the timer's `active_session_id` so the session is traceable to its start.
fn write_abandoned_session(
    conn: &Connection,
    timer: &TimerSnapshot,
    now: i64,
) -> Result<(), CommandError> {
    let session_id = timer
        .active_session_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = TimerSession {
        id: session_id,
        task_id: timer.selected_task_id.clone(),
        task_title_snapshot: timer.task_title_snapshot.clone().unwrap_or_default(),
        project_snapshot: timer.project_snapshot.clone().unwrap_or_default(),
        mode: timer.mode,
        status: SessionStatus::Abandoned,
        planned_seconds: timer.duration_seconds,
        focused_seconds: timer.duration_seconds - timer.remaining_seconds,
        started_at: timer.started_at.unwrap_or(now),
        ended_at: now,
    };
    conn.execute(
        "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                               status, planned_seconds, focused_seconds, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            session.id,
            session.task_id,
            session.task_title_snapshot,
            session.project_snapshot,
            session.mode.as_str(),
            session.status.as_str(),
            session.planned_seconds,
            session.focused_seconds,
            session.started_at,
            session.ended_at,
        ],
    )?;
    Ok(())
}

/// Checks that the timer's revision matches `expected_revision`, else CONFLICT.
fn check_revision(timer: &TimerSnapshot, expected: i64) -> Result<(), CommandError> {
    if timer.revision != expected {
        return Err(CommandError::conflict(format!(
            "timer revision mismatch: expected {expected}, found {}",
            timer.revision
        )));
    }
    Ok(())
}

/// `start_timer`: idle/done → running. Copies task snapshots, generates a
/// session UUID, computes `target_end_at`, bumps revision.
pub fn start_timer(
    conn: &mut Connection,
    settings: &AppSettings,
    input: &StartTimerInput,
) -> Result<TimerSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    if timer.state != TimerState::Idle && timer.state != TimerState::Done {
        return Err(CommandError::validation(format!(
            "start_timer requires idle or done state, found {:?}",
            timer.state
        )));
    }

    let task = match (&input.selected_task_id, input.mode) {
        (Some(id), TimerMode::Focus) => Some(get_task(&tx, id)?),
        _ => None,
    };
    let (title_snap, project_snap) = snapshot_for_mode(input.mode, task.as_ref());
    let duration = settings.duration_seconds_for_mode(input.mode);
    let now = now_millis();
    let session_id = Uuid::new_v4().to_string();

    timer.mode = input.mode;
    timer.state = TimerState::Running;
    timer.active_session_id = Some(session_id);
    timer.selected_task_id = input.selected_task_id.clone();
    timer.task_title_snapshot = Some(title_snap);
    timer.project_snapshot = Some(project_snap);
    timer.duration_seconds = duration;
    timer.remaining_seconds = duration;
    timer.started_at = Some(now);
    timer.target_end_at = Some(now + duration * 1000);
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(&tx, &timer)?;
    tx.commit()?;
    Ok(timer)
}

/// `pause_timer`: running → paused. Computes remaining from `target_end_at`,
/// clears `target_end_at`, bumps revision.
pub fn pause_timer(
    conn: &mut Connection,
    input: &crate::models::TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    if timer.state != TimerState::Running {
        return Err(CommandError::validation(format!(
            "pause_timer requires running state, found {:?}",
            timer.state
        )));
    }

    let now = now_millis();
    timer.remaining_seconds = live_remaining(&timer, now);
    timer.state = TimerState::Paused;
    timer.target_end_at = None;
    timer.paused_at = Some(now);
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(&tx, &timer)?;
    tx.commit()?;
    Ok(timer)
}

/// `resume_timer`: paused → running. Generates a new `target_end_at` from
/// remaining, bumps revision.
pub fn resume_timer(
    conn: &mut Connection,
    input: &crate::models::TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    if timer.state != TimerState::Paused {
        return Err(CommandError::validation(format!(
            "resume_timer requires paused state, found {:?}",
            timer.state
        )));
    }

    let now = now_millis();
    timer.state = TimerState::Running;
    timer.target_end_at = Some(now + timer.remaining_seconds * 1000);
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(&tx, &timer)?;
    tx.commit()?;
    Ok(timer)
}

/// `reset_timer`: any → idle (current mode). If a session was started, writes
/// an abandoned session first. Bumps revision.
pub fn reset_timer(
    conn: &mut Connection,
    settings: &AppSettings,
    input: &crate::models::TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    let now = now_millis();
    let started = timer.state != TimerState::Idle
        && timer.active_session_id.is_some()
        && timer.started_at.is_some();

    if started {
        timer.remaining_seconds = match timer.state {
            TimerState::Running => live_remaining(&timer, now),
            _ => timer.remaining_seconds,
        };
        write_abandoned_session(&tx, &timer, now)?;
    }

    let duration = settings.duration_seconds_for_mode(timer.mode);
    timer.state = TimerState::Idle;
    timer.active_session_id = None;
    timer.selected_task_id = None;
    timer.task_title_snapshot = None;
    timer.project_snapshot = None;
    timer.duration_seconds = duration;
    timer.remaining_seconds = duration;
    timer.started_at = None;
    timer.target_end_at = None;
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(&tx, &timer)?;
    tx.commit()?;
    Ok(timer)
}

/// `switch_timer_mode`: any → idle (new mode). If a session was started,
/// writes an abandoned session first. Bumps revision.
pub fn switch_timer_mode(
    conn: &mut Connection,
    settings: &AppSettings,
    input: &SwitchTimerModeInput,
) -> Result<TimerSnapshot, CommandError> {
    let tx = conn.transaction()?;
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    let now = now_millis();
    let started = timer.state != TimerState::Idle
        && timer.active_session_id.is_some()
        && timer.started_at.is_some();

    if started {
        timer.remaining_seconds = match timer.state {
            TimerState::Running => live_remaining(&timer, now),
            _ => timer.remaining_seconds,
        };
        write_abandoned_session(&tx, &timer, now)?;
    }

    let duration = settings.duration_seconds_for_mode(input.mode);
    timer.mode = input.mode;
    timer.state = TimerState::Idle;
    timer.active_session_id = None;
    timer.selected_task_id = None;
    timer.task_title_snapshot = None;
    timer.project_snapshot = None;
    timer.duration_seconds = duration;
    timer.remaining_seconds = duration;
    timer.started_at = None;
    timer.target_end_at = None;
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(&tx, &timer)?;
    tx.commit()?;
    Ok(timer)
}

/// `complete_timer`: running → done. Idempotent — if a completed session with
/// the same `activeSessionId` already exists, returns it with
/// `newlyCompleted = false`. If an abandoned session exists, returns CONFLICT.
pub fn complete_timer(
    conn: &mut Connection,
    _settings: &AppSettings,
    input: &CompleteTimerInput,
) -> Result<CompleteTimerResult, CommandError> {
    let tx = conn.transaction()?;

    // 1–2: Check if a session with this ID already exists.
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT status, mode FROM sessions WHERE id = ?1",
            params![input.active_session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    if let Some((status, _mode)) = &existing {
        if status == "completed" {
            // Idempotent: return the existing session and done timer.
            let session = tx
                .query_row(
                    &format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1"),
                    params![input.active_session_id],
                    session_from_row,
                )
                .optional()?
                .ok_or_else(|| CommandError::internal("completed session disappeared mid-query"))?;
            let timer = get_timer(&tx)?;
            let stats = all_time_statistics(&tx)?;
            return Ok(CompleteTimerResult {
                timer,
                session,
                statistics: stats,
                newly_completed: false,
            });
        }
        if status == "abandoned" {
            return Err(CommandError::conflict(
                "cannot complete a session that was already abandoned",
            ));
        }
    }

    // 3: Validate timer state, active session, revision.
    let mut timer = get_timer(&tx)?;
    check_revision(&timer, input.expected_revision)?;

    if timer.state != TimerState::Running {
        return Err(CommandError::validation(format!(
            "complete_timer requires running state, found {:?}",
            timer.state
        )));
    }
    match &timer.active_session_id {
        Some(id) if id == &input.active_session_id => {}
        _ => return Err(CommandError::validation("activeSessionId does not match timer")),
    }

    // 4: Compute focused time from target_end_at (drift-free).
    let now = now_millis();
    let actual_remaining = live_remaining(&timer, now);
    let focused = timer.duration_seconds - actual_remaining;

    let session = TimerSession {
        id: input.active_session_id.clone(),
        task_id: timer.selected_task_id.clone(),
        task_title_snapshot: timer.task_title_snapshot.clone().unwrap_or_else(|| NO_TASK_TITLE.to_owned()),
        project_snapshot: timer.project_snapshot.clone().unwrap_or_else(|| NO_TASK_PROJECT.to_owned()),
        mode: timer.mode,
        status: SessionStatus::Completed,
        planned_seconds: timer.duration_seconds,
        focused_seconds: focused.max(0),
        started_at: timer.started_at.unwrap_or(now),
        ended_at: now,
    };

    // 4: INSERT with ON CONFLICT DO NOTHING so a duplicate insert is a no-op.
    let inserted = tx.execute(
        "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                               status, planned_seconds, focused_seconds, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO NOTHING",
        params![
            session.id,
            session.task_id,
            session.task_title_snapshot,
            session.project_snapshot,
            session.mode.as_str(),
            session.status.as_str(),
            session.planned_seconds,
            session.focused_seconds,
            session.started_at,
            session.ended_at,
        ],
    )?;

    // 5: Set timer to done, remaining to zero, bump revision.
    timer.state = TimerState::Done;
    timer.remaining_seconds = 0;
    timer.target_end_at = None;
    timer.revision += 1;
    timer.updated_at = now;
    write_timer(&tx, &timer)?;

    let stats = all_time_statistics(&tx)?;
    tx.commit()?;

    // 6: newlyCompleted = true only if we actually inserted the row.
    Ok(CompleteTimerResult {
        timer,
        session,
        statistics: stats,
        newly_completed: inserted > 0,
    })
}

/// Lists sessions matching the frontend's query (limit + optional time range).
pub fn list_sessions_query(
    conn: &Connection,
    query: &SessionQuery,
) -> Result<Vec<TimerSession>, CommandError> {
    let mut sql = String::from("SELECT ");
    sql.push_str(SESSION_COLUMNS);
    sql.push_str(" FROM sessions WHERE 1=1");
    let mut bindings: Vec<i64> = Vec::new();
    if let Some(from) = query.from {
        sql.push_str(" AND started_at >= ?");
        bindings.push(from);
    }
    if let Some(to) = query.to {
        sql.push_str(" AND started_at <= ?");
        bindings.push(to);
    }
    sql.push_str(" ORDER BY started_at DESC, rowid DESC");
    if let Some(limit) = query.limit {
        sql.push_str(" LIMIT ?");
        bindings.push(limit);
    }

    let mut stmt = conn.prepare(&sql)?;
    let params = rusqlite::params_from_iter(bindings.iter());
    let rows = stmt.query_map(params, session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Validates the frontend's explicit day boundaries per the spec §6:
/// - days must be ordered by date
/// - no overlaps
/// - each segment from < to
/// - each segment must fall within the total [from, to] range
fn validate_day_boundaries(query: &StatisticsQuery) -> Result<(), CommandError> {
    let days = &query.days;
    for (i, d) in days.iter().enumerate() {
        if d.from >= d.to {
            return Err(CommandError::validation(format!(
                "day boundary '{}' has from >= to",
                d.date
            )));
        }
        if d.from < query.from || d.to > query.to {
            return Err(CommandError::validation(format!(
                "day boundary '{}' falls outside the total range",
                d.date
            )));
        }
        if i > 0 {
            let prev = &days[i - 1];
            if d.from < prev.to {
                return Err(CommandError::validation(format!(
                    "day boundaries overlap: '{}' and '{}'",
                    prev.date, d.date
                )));
            }
            if d.date <= prev.date {
                return Err(CommandError::validation(format!(
                    "day boundaries must be ordered: '{}' before '{}'",
                    d.date, prev.date
                )));
            }
        }
    }
    Ok(())
}

/// Computes statistics for an explicit time range with per-day buckets.
///
/// Per the spec §6: only `mode = 'focus' AND status = 'completed'` sessions
/// are counted. `streak_days` is the consecutive-day count ending today (or
/// yesterday if today has no sessions). `best_day` is the date with the most
/// focus seconds. Rust does NOT guess DST day buckets — it uses the explicit
/// `days` array provided by the frontend.
pub fn get_statistics(
    conn: &Connection,
    query: &StatisticsQuery,
) -> Result<Statistics, CommandError> {
    validate_day_boundaries(query)?;

    // Collect completed focus sessions in range.
    let mut stmt = conn.prepare(
        "SELECT id, task_id, task_title_snapshot, project_snapshot, mode, status,
                planned_seconds, focused_seconds, started_at, ended_at
         FROM sessions
         WHERE mode = 'focus' AND status = 'completed'
           AND started_at >= ?1 AND started_at <= ?2
         ORDER BY started_at ASC",
    )?;
    let sessions: Vec<TimerSession> = stmt
        .query_map(params![query.from, query.to], session_from_row)?
        .collect::<Result<Vec<_>, _>>()?;

    let focus_session_count = sessions.len() as i64;
    let focus_seconds: i64 = sessions.iter().map(|s| s.focused_seconds).sum();

    // by_day: bucket each session into the frontend-provided day boundaries.
    let mut by_day_map: std::collections::BTreeMap<String, (i64, i64)> =
        query.days.iter().map(|d| (d.date.clone(), (0, 0))).collect();
    for s in &sessions {
        for d in &query.days {
            // Half-open [from, to) so a session at a day boundary falls into
            // exactly one bucket, matching the spec's non-overlap invariant.
            if s.started_at >= d.from && s.started_at < d.to {
                if let Some(entry) = by_day_map.get_mut(&d.date) {
                    entry.0 += 1;
                    entry.1 += s.focused_seconds;
                }
                break;
            }
        }
    }
    let by_day: Vec<DayStat> = by_day_map
        .iter()
        .map(|(date, (sessions, seconds))| DayStat {
            date: date.clone(),
            sessions: *sessions,
            focus_seconds: *seconds,
        })
        .collect();

    // by_project: aggregate across all sessions in range.
    let mut by_project_map: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    for s in &sessions {
        let entry = by_project_map.entry(s.project_snapshot.clone()).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += s.focused_seconds;
    }
    let by_project: Vec<ProjectStat> = by_project_map
        .iter()
        .map(|(project, (sessions, seconds))| ProjectStat {
            project: project.clone(),
            sessions: *sessions,
            focus_seconds: *seconds,
        })
        .collect();

    // best_day: the date with the most focus seconds.
    let best_day = by_day
        .iter()
        .filter(|d| d.focus_seconds > 0)
        .max_by_key(|d| d.focus_seconds)
        .map(|d| d.date.clone());

    // streak_days: consecutive days ending today (or yesterday).
    let streak_days = compute_streak(&by_day);

    let settings = get_settings(conn)?;

    Ok(Statistics {
        from: query.from,
        to: query.to,
        focus_session_count,
        focus_seconds,
        daily_goal: settings.daily_goal,
        streak_days,
        best_day,
        by_day,
        by_project,
    })
}

/// Counts consecutive days with at least one completed focus session,
/// ending at the last day in `by_day` (which the frontend ensures is today
/// or the most recent day with data).
fn compute_streak(by_day: &[DayStat]) -> i64 {
    if by_day.is_empty() {
        return 0;
    }
    // Walk backwards from the end while sessions > 0.
    let mut streak = 0i64;
    for day in by_day.iter().rev() {
        if day.sessions > 0 {
            streak += 1;
        } else {
            break;
        }
    }
    streak
}

/// All-time focus totals.
///
/// `by_day`, `streak_days` and `best_day` all depend on the caller's local
/// calendar boundaries, so they stay empty here and are filled by
/// `get_statistics` (T9), which receives explicit day buckets from the
/// frontend.
pub fn all_time_statistics(conn: &Connection) -> Result<Statistics, CommandError> {
    let (count, seconds) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(focused_seconds), 0)
         FROM sessions WHERE mode = 'focus' AND status = 'completed'",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT project_snapshot, COUNT(*) AS sessions, COALESCE(SUM(focused_seconds), 0) AS focus_seconds
         FROM sessions
         WHERE mode = 'focus' AND status = 'completed'
         GROUP BY project_snapshot
         ORDER BY focus_seconds DESC, project_snapshot ASC",
    )?;
    let by_project = stmt
        .query_map([], |row| {
            Ok(ProjectStat {
                project: row.get(0)?,
                sessions: row.get(1)?,
                focus_seconds: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let settings = get_settings(conn)?;

    Ok(Statistics {
        from: 0,
        to: now_millis(),
        focus_session_count: count,
        focus_seconds: seconds,
        daily_goal: settings.daily_goal,
        streak_days: 0,
        best_day: None,
        by_day: Vec::new(),
        by_project,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::StatisticsDayBoundary;

    fn create_input(title: &str) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_owned(),
            pomodoro_target: 4,
            priority: TaskPriority::High,
            project: "Abyssal".to_owned(),
        }
    }

    fn seed_session(
        conn: &Connection,
        id: &str,
        mode: TimerMode,
        status: SessionStatus,
        project: &str,
        focused_seconds: i64,
    ) {
        conn.execute(
            "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                                   status, planned_seconds, focused_seconds, started_at, ended_at)
             VALUES (?1, NULL, 'snapshot', ?2, ?3, ?4, 1500, ?5, 1, 2)",
            params![id, project, mode.as_str(), status.as_str(), focused_seconds],
        )
        .expect("session should insert");
    }

    #[test]
    fn created_tasks_round_trip_through_the_database() {
        let conn = db::open_in_memory().expect("database should open");

        let task = insert_task(&conn, &create_input("Write the migration")).expect("task should insert");
        let stored = get_task(&conn, &task.id).expect("task should load");

        assert_eq!(stored.title, "Write the migration");
        assert_eq!(stored.pomodoro_target, 4);
        assert_eq!(stored.priority, TaskPriority::High);
        assert_eq!(stored.project, "Abyssal");
        assert!(!stored.done);
        assert_eq!(stored.completed_at, None);
    }

    #[test]
    fn tasks_are_returned_in_sort_order() {
        let conn = db::open_in_memory().expect("database should open");

        let first = insert_task(&conn, &create_input("First")).expect("insert");
        let second = insert_task(&conn, &create_input("Second")).expect("insert");

        let tasks = list_tasks(&conn).expect("list");
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, first.id);
        assert_eq!(tasks[1].id, second.id);
        assert!(second.sort_order > first.sort_order);
    }

    #[test]
    fn blank_and_oversized_titles_are_rejected() {
        let conn = db::open_in_memory().expect("database should open");

        let blank = insert_task(&conn, &create_input("   "));
        assert!(matches!(blank, Err(err) if err.code == crate::error::ErrorCode::ValidationError));

        let too_long = insert_task(&conn, &create_input(&"x".repeat(MAX_TITLE_CHARS + 1)));
        assert!(matches!(too_long, Err(err) if err.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn out_of_range_pomodoro_targets_are_rejected() {
        let conn = db::open_in_memory().expect("database should open");

        for target in [0, -1, MAX_POMODORO_TARGET + 1] {
            let mut input = create_input("Bad target");
            input.pomodoro_target = target;
            let result = insert_task(&conn, &input);
            assert!(result.is_err(), "target {target} should be rejected");
        }
    }

    #[test]
    fn blank_project_falls_back_to_the_default() {
        let conn = db::open_in_memory().expect("database should open");
        let mut input = create_input("No project");
        input.project = "  ".to_owned();

        let task = insert_task(&conn, &input).expect("insert");

        assert_eq!(task.project, DEFAULT_PROJECT);
    }

    #[test]
    fn update_applies_only_the_supplied_fields() {
        let conn = db::open_in_memory().expect("database should open");
        let task = insert_task(&conn, &create_input("Original")).expect("insert");

        let updated = update_task(
            &conn,
            &UpdateTaskInput {
                id: task.id.clone(),
                title: Some("Renamed".to_owned()),
                pomodoro_target: None,
                priority: Some(TaskPriority::Low),
                project: None,
                done: None,
            },
        )
        .expect("update");

        assert_eq!(updated.title, "Renamed");
        assert_eq!(updated.priority, TaskPriority::Low);
        assert_eq!(updated.pomodoro_target, 4, "untouched fields must persist");
        assert_eq!(updated.project, "Abyssal");
    }

    #[test]
    fn toggling_done_sets_and_clears_completed_at() {
        let conn = db::open_in_memory().expect("database should open");
        let task = insert_task(&conn, &create_input("Finish me")).expect("insert");

        let done = update_task(
            &conn,
            &UpdateTaskInput {
                id: task.id.clone(),
                title: None,
                pomodoro_target: None,
                priority: None,
                project: None,
                done: Some(true),
            },
        )
        .expect("update");
        assert!(done.done);
        assert!(done.completed_at.is_some());

        let reopened = update_task(
            &conn,
            &UpdateTaskInput {
                id: task.id.clone(),
                title: None,
                pomodoro_target: None,
                priority: None,
                project: None,
                done: Some(false),
            },
        )
        .expect("update");
        assert!(!reopened.done);
        assert_eq!(reopened.completed_at, None);
    }

    #[test]
    fn updating_or_deleting_a_missing_task_is_not_found() {
        let conn = db::open_in_memory().expect("database should open");

        let update = update_task(
            &conn,
            &UpdateTaskInput {
                id: "missing".to_owned(),
                title: Some("Nope".to_owned()),
                pomodoro_target: None,
                priority: None,
                project: None,
                done: None,
            },
        );
        assert!(matches!(update, Err(err) if err.code == crate::error::ErrorCode::NotFound));

        let delete = delete_task(&conn, "missing");
        assert!(matches!(delete, Err(err) if err.code == crate::error::ErrorCode::NotFound));
    }

    #[test]
    fn delete_removes_the_task() {
        let conn = db::open_in_memory().expect("database should open");
        let task = insert_task(&conn, &create_input("Temporary")).expect("insert");

        delete_task(&conn, &task.id).expect("delete");

        assert!(get_task(&conn, &task.id).is_err());
        assert!(list_tasks(&conn).expect("list").is_empty());
    }

    #[test]
    fn all_time_statistics_only_count_completed_focus_sessions() {
        let conn = db::open_in_memory().expect("database should open");

        seed_session(&conn, "s1", TimerMode::Focus, SessionStatus::Completed, "Abyssal", 1500);
        seed_session(&conn, "s2", TimerMode::Focus, SessionStatus::Completed, "Abyssal", 1200);
        seed_session(&conn, "s3", TimerMode::Focus, SessionStatus::Abandoned, "Abyssal", 900);
        seed_session(&conn, "s4", TimerMode::Short, SessionStatus::Completed, "休息", 300);

        let stats = all_time_statistics(&conn).expect("statistics");

        assert_eq!(stats.focus_session_count, 2);
        assert_eq!(stats.focus_seconds, 2700);
        assert_eq!(stats.daily_goal, 8);
        assert_eq!(stats.by_project.len(), 1);
        assert_eq!(stats.by_project[0].project, "Abyssal");
        assert_eq!(stats.by_project[0].sessions, 2);
        assert_eq!(stats.by_project[0].focus_seconds, 2700);
    }

    #[test]
    fn save_settings_persists_and_returns_the_updated_row() {
        let conn = db::open_in_memory().expect("database should open");

        let mut settings = get_settings(&conn).expect("default settings");
        settings.focus_duration_minutes = 30;
        settings.short_break_minutes = 10;
        settings.long_break_minutes = 20;
        settings.daily_goal = 6;
        settings.auto_start_break = true;

        let result = save_settings(&conn, &settings).expect("save");
        assert_eq!(result.settings.focus_duration_minutes, 30);
        assert_eq!(result.settings.short_break_minutes, 10);
        assert_eq!(result.settings.long_break_minutes, 20);
        assert_eq!(result.settings.daily_goal, 6);
        assert!(result.settings.auto_start_break);
        assert!(result.settings.updated_at > 0);

        // Re-read to confirm persistence.
        let reread = get_settings(&conn).expect("re-read");
        assert_eq!(reread.focus_duration_minutes, 30);
        assert_eq!(reread.daily_goal, 6);
    }

    #[test]
    fn save_settings_refreshes_idle_timer_durations() {
        let conn = db::open_in_memory().expect("database should open");

        let mut settings = get_settings(&conn).expect("default settings");
        settings.focus_duration_minutes = 45;

        let result = save_settings(&conn, &settings).expect("save");

        // Idle timer should reflect the new 45-minute focus duration.
        assert_eq!(result.timer.state, TimerState::Idle);
        assert_eq!(result.timer.mode, TimerMode::Focus);
        assert_eq!(result.timer.duration_seconds, 45 * 60);
        assert_eq!(result.timer.remaining_seconds, 45 * 60);
    }

    #[test]
    fn save_settings_rejects_out_of_range_durations_and_goals() {
        let conn = db::open_in_memory().expect("database should open");

        let mut settings = get_settings(&conn).expect("default settings");

        settings.focus_duration_minutes = 0;
        assert!(save_settings(&conn, &settings).is_err());

        settings.focus_duration_minutes = 25;
        settings.short_break_minutes = 200;
        assert!(save_settings(&conn, &settings).is_err());

        settings.short_break_minutes = 5;
        settings.daily_goal = 0;
        assert!(save_settings(&conn, &settings).is_err());

        settings.daily_goal = 100;
        assert!(save_settings(&conn, &settings).is_err());
    }

    // ─── Statistics tests (T9) ───────────────────────────────────────────────

    fn seed_completed_focus(conn: &Connection, id: &str, started_at: i64, focused: i64, project: &str) {
        conn.execute(
            "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                                   status, planned_seconds, focused_seconds, started_at, ended_at)
             VALUES (?1, NULL, 'task', ?2, 'focus', 'completed', 1500, ?3, ?4, ?5)",
            params![id, project, focused, started_at, started_at + focused * 1000],
        )
        .expect("seed session");
    }

    #[test]
    fn get_statistics_buckets_sessions_into_explicit_day_boundaries() {
        let conn = db::open_in_memory().expect("db");

        // Day 1: 0..86400000, Day 2: 86400000..172800000
        seed_completed_focus(&conn, "s1", 1000, 1500, "Abyssal");
        seed_completed_focus(&conn, "s2", 50000000, 1500, "Abyssal");
        seed_completed_focus(&conn, "s3", 80000000, 1200, "Design");
        seed_completed_focus(&conn, "s4", 100000000, 1500, "Abyssal");

        let stats = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 172800000,
                days: vec![
                    StatisticsDayBoundary { date: "2026-01-01".into(), from: 0, to: 86400000 },
                    StatisticsDayBoundary { date: "2026-01-02".into(), from: 86400000, to: 172800000 },
                ],
            },
        )
        .expect("stats");

        assert_eq!(stats.focus_session_count, 4);
        assert_eq!(stats.focus_seconds, 5700);
        assert_eq!(stats.by_day.len(), 2);
        assert_eq!(stats.by_day[0].date, "2026-01-01");
        assert_eq!(stats.by_day[0].sessions, 3);
        assert_eq!(stats.by_day[0].focus_seconds, 4200);
        assert_eq!(stats.by_day[1].date, "2026-01-02");
        assert_eq!(stats.by_day[1].sessions, 1);
        assert_eq!(stats.by_day[1].focus_seconds, 1500);
    }

    #[test]
    fn get_statistics_computes_by_project_aggregation() {
        let conn = db::open_in_memory().expect("db");

        seed_completed_focus(&conn, "s1", 1000, 1500, "Abyssal");
        seed_completed_focus(&conn, "s2", 2000, 1500, "Abyssal");
        seed_completed_focus(&conn, "s3", 3000, 900, "Design");

        let stats = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 172800000,
                days: vec![],
            },
        )
        .expect("stats");

        assert_eq!(stats.by_project.len(), 2);
        let abyssal = stats.by_project.iter().find(|p| p.project == "Abyssal").expect("Abyssal");
        assert_eq!(abyssal.sessions, 2);
        assert_eq!(abyssal.focus_seconds, 3000);
    }

    #[test]
    fn get_statistics_finds_best_day() {
        let conn = db::open_in_memory().expect("db");

        seed_completed_focus(&conn, "s1", 1000, 1500, "A");
        seed_completed_focus(&conn, "s2", 90000000, 3000, "B");

        let stats = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 172800000,
                days: vec![
                    StatisticsDayBoundary { date: "d1".into(), from: 0, to: 86400000 },
                    StatisticsDayBoundary { date: "d2".into(), from: 86400000, to: 172800000 },
                ],
            },
        )
        .expect("stats");

        assert_eq!(stats.best_day, Some("d2".to_owned()));
    }

    #[test]
    fn get_statistics_computes_streak_from_consecutive_days() {
        let conn = db::open_in_memory().expect("db");

        // 3 consecutive days with sessions, then a gap.
        seed_completed_focus(&conn, "s1", 0, 1500, "A");
        seed_completed_focus(&conn, "s2", 86400000, 1500, "A");
        seed_completed_focus(&conn, "s3", 172800000, 1500, "A");
        // Day 4: no session.
        // Day 5: session (streak should be 2 from the end).
        seed_completed_focus(&conn, "s4", 345600000, 1500, "A");

        let stats = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 432000000,
                days: vec![
                    StatisticsDayBoundary { date: "d1".into(), from: 0, to: 86400000 },
                    StatisticsDayBoundary { date: "d2".into(), from: 86400000, to: 172800000 },
                    StatisticsDayBoundary { date: "d3".into(), from: 172800000, to: 259200000 },
                    StatisticsDayBoundary { date: "d4".into(), from: 259200000, to: 345600000 },
                    StatisticsDayBoundary { date: "d5".into(), from: 345600000, to: 432000000 },
                ],
            },
        )
        .expect("stats");

        // Walking backwards: d5 has 1 session, d4 has 0 → streak = 1.
        assert_eq!(stats.streak_days, 1);
    }

    #[test]
    fn get_statistics_rejects_overlapping_day_boundaries() {
        let conn = db::open_in_memory().expect("db");

        let result = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 172800000,
                days: vec![
                    StatisticsDayBoundary { date: "d1".into(), from: 0, to: 90000000 },
                    StatisticsDayBoundary { date: "d2".into(), from: 80000000, to: 172800000 },
                ],
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn get_statistics_rejects_unordered_dates() {
        let conn = db::open_in_memory().expect("db");

        let result = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 0,
                to: 172800000,
                days: vec![
                    StatisticsDayBoundary { date: "2026-01-02".into(), from: 0, to: 86400000 },
                    StatisticsDayBoundary { date: "2026-01-01".into(), from: 86400000, to: 172800000 },
                ],
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn get_statistics_rejects_boundary_outside_total_range() {
        let conn = db::open_in_memory().expect("db");

        let result = get_statistics(
            &conn,
            &StatisticsQuery {
                from: 1000,
                to: 2000,
                days: vec![
                    StatisticsDayBoundary { date: "d1".into(), from: 0, to: 500 },
                ],
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn list_sessions_query_filters_by_time_range_and_limit() {
        let conn = db::open_in_memory().expect("db");

        seed_completed_focus(&conn, "s1", 100, 1500, "A");
        seed_completed_focus(&conn, "s2", 200, 1500, "A");
        seed_completed_focus(&conn, "s3", 300, 1500, "A");

        let all = list_sessions_query(&conn, &SessionQuery { limit: None, from: None, to: None })
            .expect("query");
        assert_eq!(all.len(), 3);

        let limited = list_sessions_query(&conn, &SessionQuery { limit: Some(2), from: None, to: None })
            .expect("query");
        assert_eq!(limited.len(), 2);
        // Most recent first.
        assert_eq!(limited[0].id, "s3");

        let ranged = list_sessions_query(&conn, &SessionQuery { limit: None, from: Some(150), to: Some(250) })
            .expect("query");
        assert_eq!(ranged.len(), 1);
        assert_eq!(ranged[0].id, "s2");
    }

    // ─── Timer state machine tests ───────────────────────────────────────────

    fn settings() -> AppSettings {
        AppSettings::default()
    }

    #[test]
    fn start_timer_creates_a_running_session_with_task_snapshot() {
        let mut conn = db::open_in_memory().expect("db");
        let task = insert_task(&conn, &CreateTaskInput {
            title: "Write tests".to_owned(),
            pomodoro_target: 3,
            priority: TaskPriority::High,
            project: "Backend".to_owned(),
        }).expect("task");

        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0,
            mode: TimerMode::Focus,
            selected_task_id: Some(task.id.clone()),
        }).expect("start");

        assert_eq!(timer.state, TimerState::Running);
        assert_eq!(timer.mode, TimerMode::Focus);
        assert!(timer.active_session_id.is_some());
        assert_eq!(timer.selected_task_id, Some(task.id));
        assert_eq!(timer.task_title_snapshot.as_deref(), Some("Write tests"));
        assert_eq!(timer.project_snapshot.as_deref(), Some("Backend"));
        assert!(timer.target_end_at.is_some());
        assert_eq!(timer.revision, 1);
        assert_eq!(timer.duration_seconds, 1500);
    }

    #[test]
    fn start_timer_without_task_uses_fixed_snapshot() {
        let mut conn = db::open_in_memory().expect("db");

        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0,
            mode: TimerMode::Focus,
            selected_task_id: None,
        }).expect("start");

        assert_eq!(timer.task_title_snapshot.as_deref(), Some("未指定任务"));
        assert_eq!(timer.project_snapshot.as_deref(), Some("通用"));
    }

    #[test]
    fn start_short_break_uses_break_snapshot() {
        let mut conn = db::open_in_memory().expect("db");

        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0,
            mode: TimerMode::Short,
            selected_task_id: None,
        }).expect("start");

        assert_eq!(timer.task_title_snapshot.as_deref(), Some("短休"));
        assert_eq!(timer.project_snapshot.as_deref(), Some("休息"));
        assert_eq!(timer.duration_seconds, 300);
    }

    #[test]
    fn start_rejects_wrong_revision() {
        let mut conn = db::open_in_memory().expect("db");

        let result = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 99,
            mode: TimerMode::Focus,
            selected_task_id: None,
        });

        assert!(matches!(result, Err(e) if e.code == crate::error::ErrorCode::Conflict));
    }

    #[test]
    fn start_rejects_already_running() {
        let mut conn = db::open_in_memory().expect("db");
        start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("first start");

        let result = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 1, mode: TimerMode::Focus, selected_task_id: None,
        });

        assert!(result.is_err());
    }

    #[test]
    fn pause_resume_round_trip_preserves_remaining() {
        let mut conn = db::open_in_memory().expect("db");
        let mut timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");

        // Simulate 5 seconds elapsed.
        timer.target_end_at = Some(now_millis() + (1500 - 5) * 1000);
        write_timer(&conn, &timer).expect("write");

        let paused = pause_timer(&mut conn, &crate::models::TimerRevisionInput {
            expected_revision: 1,
        }).expect("pause");

        assert_eq!(paused.state, TimerState::Paused);
        assert!(paused.target_end_at.is_none());
        assert!(paused.paused_at.is_some());
        assert_eq!(paused.revision, 2);
        // Remaining should be ~1495 (allow small timing drift).
        assert!(paused.remaining_seconds >= 1490 && paused.remaining_seconds <= 1500);

        let resumed = resume_timer(&mut conn, &crate::models::TimerRevisionInput {
            expected_revision: 2,
        }).expect("resume");

        assert_eq!(resumed.state, TimerState::Running);
        assert!(resumed.target_end_at.is_some());
        assert!(resumed.paused_at.is_none());
        assert_eq!(resumed.revision, 3);
    }

    #[test]
    fn pause_rejects_non_running() {
        let mut conn = db::open_in_memory().expect("db");

        let result = pause_timer(&mut conn, &crate::models::TimerRevisionInput {
            expected_revision: 0,
        });

        assert!(result.is_err());
    }

    #[test]
    fn reset_from_running_writes_abandoned_and_returns_idle() {
        let mut conn = db::open_in_memory().expect("db");
        let mut timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");

        // Simulate 10s elapsed.
        timer.target_end_at = Some(now_millis() + 1490 * 1000);
        write_timer(&conn, &timer).expect("write");

        let reset = reset_timer(&mut conn, &settings(), &crate::models::TimerRevisionInput {
            expected_revision: 1,
        }).expect("reset");

        assert_eq!(reset.state, TimerState::Idle);
        assert_eq!(reset.active_session_id, None);
        assert_eq!(reset.revision, 2);
        assert_eq!(reset.remaining_seconds, 1500);

        let sessions = list_sessions(&conn, 10).expect("sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, SessionStatus::Abandoned);
    }

    #[test]
    fn reset_from_idle_does_not_create_session() {
        let mut conn = db::open_in_memory().expect("db");

        let reset = reset_timer(&mut conn, &settings(), &crate::models::TimerRevisionInput {
            expected_revision: 0,
        }).expect("reset");

        assert_eq!(reset.state, TimerState::Idle);
        assert_eq!(reset.revision, 1);

        let sessions = list_sessions(&conn, 10).expect("sessions");
        assert!(sessions.is_empty());
    }

    #[test]
    fn switch_mode_writes_abandoned_and_changes_mode() {
        let mut conn = db::open_in_memory().expect("db");
        start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");

        let switched = switch_timer_mode(&mut conn, &settings(), &SwitchTimerModeInput {
            expected_revision: 1, mode: TimerMode::Short,
        }).expect("switch");

        assert_eq!(switched.mode, TimerMode::Short);
        assert_eq!(switched.state, TimerState::Idle);
        assert_eq!(switched.duration_seconds, 300);
        assert_eq!(switched.revision, 2);

        let sessions = list_sessions(&conn, 10).expect("sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].status, SessionStatus::Abandoned);
        assert_eq!(sessions[0].mode, TimerMode::Focus);
    }

    #[test]
    fn complete_timer_creates_completed_session_and_done_timer() {
        let mut conn = db::open_in_memory().expect("db");
        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");
        let session_id = timer.active_session_id.clone().unwrap();

        let result = complete_timer(&mut conn, &settings(), &CompleteTimerInput {
            expected_revision: 1,
            active_session_id: session_id.clone(),
            recovery: None,
        }).expect("complete");

        assert!(result.newly_completed);
        assert_eq!(result.timer.state, TimerState::Done);
        assert_eq!(result.timer.remaining_seconds, 0);
        assert_eq!(result.timer.revision, 2);
        assert_eq!(result.session.id, session_id);
        assert_eq!(result.session.status, SessionStatus::Completed);
        assert_eq!(result.session.mode, TimerMode::Focus);
    }

    #[test]
    fn complete_timer_is_idempotent() {
        let mut conn = db::open_in_memory().expect("db");
        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");
        let session_id = timer.active_session_id.clone().unwrap();

        let first = complete_timer(&mut conn, &settings(), &CompleteTimerInput {
            expected_revision: 1, active_session_id: session_id.clone(), recovery: None,
        }).expect("first complete");

        assert!(first.newly_completed);

        // Second call with the same session ID returns the same session.
        let second = complete_timer(&mut conn, &settings(), &CompleteTimerInput {
            expected_revision: 2, active_session_id: session_id, recovery: None,
        }).expect("idempotent");

        assert!(!second.newly_completed);
        assert_eq!(second.session.id, first.session.id);
        assert_eq!(second.session.status, SessionStatus::Completed);

        // Only one session in the DB.
        let sessions = list_sessions(&conn, 10).expect("sessions");
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn complete_timer_rejects_abandoned_session_id() {
        let mut conn = db::open_in_memory().expect("db");
        let timer = start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");
        let session_id = timer.active_session_id.clone().unwrap();

        // Reset writes an abandoned session with that ID.
        reset_timer(&mut conn, &settings(), &crate::models::TimerRevisionInput {
            expected_revision: 1,
        }).expect("reset");

        let result = complete_timer(&mut conn, &settings(), &CompleteTimerInput {
            expected_revision: 2, active_session_id: session_id, recovery: None,
        });

        assert!(matches!(result, Err(e) if e.code == crate::error::ErrorCode::Conflict));
    }

    #[test]
    fn complete_timer_rejects_mismatched_session_id() {
        let mut conn = db::open_in_memory().expect("db");
        start_timer(&mut conn, &settings(), &StartTimerInput {
            expected_revision: 0, mode: TimerMode::Focus, selected_task_id: None,
        }).expect("start");

        let result = complete_timer(&mut conn, &settings(), &CompleteTimerInput {
            expected_revision: 1,
            active_session_id: "wrong-id".to_owned(),
            recovery: None,
        });

        assert!(result.is_err());
    }
}
