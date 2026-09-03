use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use crate::error::CommandError;
use crate::models::{
    AppSettings, CreateTaskInput, ProjectStat, SaveSettingsResult, SessionStatus, Statistics, Task,
    TaskPriority, TimerMode, TimerSession, TimerSnapshot, TimerState, UpdateTaskInput,
};

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
}
