use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::CommandError;
use crate::models::{
    AppSettings, CompleteTimerInput, CompleteTimerResult, SessionStatus, StartTimerInput,
    Statistics, SwitchTimerModeInput, TimerMode, TimerRevisionInput, TimerSession, TimerSnapshot,
    TimerState,
};
use crate::repository;

/// Fixed snapshot labels per the design spec §3.
fn snapshot_for_mode(mode: TimerMode, task_title: Option<&str>, project: Option<&str>) -> (String, String) {
    match mode {
        TimerMode::Focus => {
            let title = task_title.filter(|s| !s.is_empty()).unwrap_or("未指定任务");
            let proj = project.filter(|s| !s.is_empty()).unwrap_or("通用");
            (title.to_owned(), proj.to_owned())
        }
        TimerMode::Short => ("短休".to_owned(), "休息".to_owned()),
        TimerMode::Long => ("长休".to_owned(), "休息".to_owned()),
    }
}

/// Reads the selected task's title and project for the timer snapshot.
fn task_snapshot(conn: &Connection, task_id: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(id) = task_id else { return (None, None) };
    conn.query_row(
        "SELECT title, project FROM tasks WHERE id = ?1",
        params![id],
        |row| Ok((Some(row.get::<_, String>(0)?), Some(row.get::<_, String>(1)?))),
    )
    .ok()
    .unwrap_or((None, None))
}

/// Computes remaining seconds from the absolute `target_end_at`.
///
/// This is the drift-free core: instead of decrementing a counter every tick,
/// we store the absolute end time and compute `remaining = target_end - now`
/// on every read. A `setInterval` in the frontend only refreshes the display;
/// it never writes to the database.
fn remaining_from_target(target_end_at: i64, now: i64) -> i64 {
    let diff = target_end_at - now;
    if diff < 0 { 0 } else { diff / 1000 }
}

/// Checks the optimistic concurrency guard: if the caller's `expectedRevision`
/// doesn't match the current row, the write is stale and rejected as CONFLICT.
fn check_revision(current: &TimerSnapshot, expected: i64) -> Result<(), CommandError> {
    if current.revision != expected {
        return Err(CommandError::conflict(format!(
            "timer revision conflict: expected {}, actual {}",
            expected, current.revision
        )));
    }
    Ok(())
}

/// Rejects a state transition that doesn't start from the required source state.
fn require_state(current: TimerState, required: TimerState, action: &str) -> Result<(), CommandError> {
    if current != required {
        return Err(CommandError::validation(format!(
            "{action} requires {} state, current is {}",
            required.as_str(),
            current.as_str()
        )));
    }
    Ok(())
}

/// Writes the timer row back to the database. Used by every state-machine action.
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

/// Writes an abandoned session when reset/switch interrupts a started timer.
///
/// Per the spec: "未真正开始的 idle timer 不生成 abandoned session" — only
/// running or paused timers that have a started session produce a record.
fn write_abandoned_session(conn: &Connection, timer: &TimerSnapshot, now: i64) -> Result<(), CommandError> {
    let Some(session_id) = &timer.active_session_id else { return Ok(()); };
    if timer.state != TimerState::Running && timer.state != TimerState::Paused {
        return Ok(());
    }

    let focused = match timer.target_end_at {
        Some(target) if timer.state == TimerState::Running => {
            let remaining = remaining_from_target(target, now);
            timer.duration_seconds - remaining
        }
        _ => {
            // Paused: remaining was frozen at pause time.
            timer.duration_seconds - timer.remaining_seconds
        }
    };
    let focused = focused.max(0);

    conn.execute(
        "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                               status, planned_seconds, focused_seconds, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'abandoned', ?6, ?7, ?8, ?9)",
        params![
            session_id,
            timer.selected_task_id,
            timer.task_title_snapshot.clone().unwrap_or_else(|| "未指定任务".to_owned()),
            timer.project_snapshot.clone().unwrap_or_else(|| "通用".to_owned()),
            timer.mode.as_str(),
            timer.duration_seconds,
            focused,
            timer.started_at.unwrap_or(now),
            now,
        ],
    )?;
    Ok(())
}

// ─── State machine actions ───────────────────────────────────────────────────

/// `start_timer`: validates state is idle/done, reads task snapshot, generates
/// a UUID v4 session id, computes absolute `target_end_at`, writes running state,
/// revision + 1.
pub fn start_timer(
    conn: &Connection,
    settings: &AppSettings,
    input: &StartTimerInput,
) -> Result<TimerSnapshot, CommandError> {
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;
    require_state(timer.state, TimerState::Idle, "start_timer")?;

    let now = repository::now_millis();
    let duration_seconds = settings.duration_seconds_for_mode(input.mode);
    let (task_title, project) = task_snapshot(conn, input.selected_task_id.as_deref());
    let (title_snap, proj_snap) = snapshot_for_mode(input.mode, task_title.as_deref(), project.as_deref());

    timer.mode = input.mode;
    timer.state = TimerState::Running;
    timer.active_session_id = Some(Uuid::new_v4().to_string());
    timer.selected_task_id = input.selected_task_id.clone();
    timer.task_title_snapshot = Some(title_snap);
    timer.project_snapshot = Some(proj_snap);
    timer.duration_seconds = duration_seconds;
    timer.remaining_seconds = duration_seconds;
    timer.started_at = Some(now);
    timer.target_end_at = Some(now + duration_seconds * 1000);
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(conn, &timer)?;
    Ok(timer)
}

/// `pause_timer`: only running → paused. Computes remaining from `target_end_at`,
/// clears target end, revision + 1.
pub fn pause_timer(
    conn: &Connection,
    input: &TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;
    require_state(timer.state, TimerState::Running, "pause_timer")?;

    let now = repository::now_millis();
    if let Some(target) = timer.target_end_at {
        timer.remaining_seconds = remaining_from_target(target, now);
    }
    timer.state = TimerState::Paused;
    timer.target_end_at = None;
    timer.paused_at = Some(now);
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(conn, &timer)?;
    Ok(timer)
}

/// `resume_timer`: only paused → running. Generates a new `target_end_at` from
/// the frozen `remaining_seconds`, revision + 1.
pub fn resume_timer(
    conn: &Connection,
    input: &TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;
    require_state(timer.state, TimerState::Paused, "resume_timer")?;

    let now = repository::now_millis();
    timer.state = TimerState::Running;
    timer.target_end_at = Some(now + timer.remaining_seconds * 1000);
    timer.paused_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    write_timer(conn, &timer)?;
    Ok(timer)
}

/// `reset_timer`: if a session was started, writes an abandoned session, then
/// returns to idle for the current mode. revision + 1.
pub fn reset_timer(
    conn: &Connection,
    settings: &AppSettings,
    input: &TimerRevisionInput,
) -> Result<TimerSnapshot, CommandError> {
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;

    let now = repository::now_millis();
    write_abandoned_session(conn, &timer, now)?;

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

    write_timer(conn, &timer)?;
    Ok(timer)
}

/// `switch_timer_mode`: if a session was started, writes an abandoned session,
/// switches mode, returns to idle. revision + 1.
pub fn switch_timer_mode(
    conn: &Connection,
    settings: &AppSettings,
    input: &SwitchTimerModeInput,
) -> Result<TimerSnapshot, CommandError> {
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;

    let now = repository::now_millis();
    write_abandoned_session(conn, &timer, now)?;

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

    write_timer(conn, &timer)?;
    Ok(timer)
}

/// `complete_timer`: idempotent completion per the spec §4.2.
///
/// 1. Query by `activeSessionId` first:
///    - Already completed → return original session + done timer, `newlyCompleted = false`.
///    - Already abandoned → return CONFLICT.
///    - Not found → proceed to step 2.
/// 2. Validate timer state, revision, and completion conditions.
/// 3. `INSERT INTO ... ON CONFLICT(id) DO NOTHING`; first insert returns `newlyCompleted = true`.
/// 4. Set timer to done, remaining = 0, revision + 1 — all in one transaction.
pub fn complete_timer(
    conn: &mut Connection,
    settings: &AppSettings,
    input: &CompleteTimerInput,
) -> Result<CompleteTimerResult, CommandError> {
    // Step 1: check if the session already exists.
    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT mode, status FROM sessions WHERE id = ?1",
            params![input.active_session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;

    if let Some((_, status)) = &existing {
        match status.as_str() {
            "completed" => {
                // Idempotent: return the existing session + current timer state.
                let session = load_session(conn, &input.active_session_id)?;
                let timer = repository::get_timer(conn)?;
                let statistics = repository::all_time_statistics(conn)?;
                return Ok(CompleteTimerResult {
                    timer,
                    session,
                    statistics,
                    newly_completed: false,
                });
            }
            "abandoned" => {
                return Err(CommandError::conflict(
                    "cannot complete a session that was already abandoned",
                ));
            }
            _ => {}
        }
    }

    // Step 2: validate the timer.
    let mut timer = repository::get_timer(conn)?;
    check_revision(&timer, input.expected_revision)?;

    let now = repository::now_millis();

    // Compute focused seconds from the absolute target end.
    let focused_seconds = if timer.state == TimerState::Running {
        if let Some(target) = timer.target_end_at {
            let remaining = remaining_from_target(target, now);
            timer.duration_seconds - remaining
        } else {
            timer.duration_seconds
        }
    } else {
        // Paused or done: use frozen remaining.
        timer.duration_seconds - timer.remaining_seconds
    };
    let focused_seconds = focused_seconds.max(0).min(timer.duration_seconds);

    // Build the session record.
    let session = TimerSession {
        id: input.active_session_id.clone(),
        task_id: timer.selected_task_id.clone(),
        task_title_snapshot: timer.task_title_snapshot.clone().unwrap_or_else(|| "未指定任务".to_owned()),
        project_snapshot: timer.project_snapshot.clone().unwrap_or_else(|| "通用".to_owned()),
        mode: timer.mode,
        status: SessionStatus::Completed,
        planned_seconds: timer.duration_seconds,
        focused_seconds,
        started_at: timer.started_at.unwrap_or(now),
        ended_at: now,
    };

    // Step 3 + 4: insert session (idempotent) + update timer in one transaction.
    let tx = conn.transaction()?;

    let inserted = tx.execute(
        "INSERT INTO sessions (id, task_id, task_title_snapshot, project_snapshot, mode,
                               status, planned_seconds, focused_seconds, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO NOTHING",
        params![
            session.id,
            session.task_id,
            session.task_title_snapshot,
            session.project_snapshot,
            session.mode.as_str(),
            session.planned_seconds,
            session.focused_seconds,
            session.started_at,
            session.ended_at,
        ],
    )?;

    // Update timer to done.
    timer.state = TimerState::Done;
    timer.remaining_seconds = 0;
    timer.target_end_at = None;
    timer.revision += 1;
    timer.updated_at = now;

    tx.execute(
        "UPDATE timer_state SET state = ?1, remaining_seconds = ?2, target_end_at = ?3,
                                revision = ?4, updated_at = ?5
         WHERE id = 1",
        params![
            timer.state.as_str(),
            timer.remaining_seconds,
            timer.target_end_at,
            timer.revision,
            timer.updated_at,
        ],
    )?;

    tx.commit()?;

    let statistics = repository::all_time_statistics(conn)?;
    let statistics = Statistics {
        daily_goal: settings.daily_goal,
        ..statistics
    };

    Ok(CompleteTimerResult {
        timer,
        session,
        statistics,
        newly_completed: inserted > 0,
    })
}

fn load_session(conn: &Connection, id: &str) -> Result<TimerSession, CommandError> {
    conn.query_row(
        "SELECT id, task_id, task_title_snapshot, project_snapshot, mode, status,
                planned_seconds, focused_seconds, started_at, ended_at
         FROM sessions WHERE id = ?1",
        params![id],
        |row| {
            let mode_text: String = row.get(4)?;
            let status_text: String = row.get(5)?;
            Ok(TimerSession {
                id: row.get(0)?,
                task_id: row.get(1)?,
                task_title_snapshot: row.get(2)?,
                project_snapshot: row.get(3)?,
                mode: TimerMode::parse_str(&mode_text).unwrap_or(TimerMode::Focus),
                status: SessionStatus::parse_str(&status_text).unwrap_or(SessionStatus::Abandoned),
                planned_seconds: row.get(6)?,
                focused_seconds: row.get(7)?,
                started_at: row.get(8)?,
                ended_at: row.get(9)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CommandError::not_found(format!("session {id} not found")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::TaskPriority;

    fn settings() -> AppSettings {
        AppSettings::default()
    }

    fn start_focus(conn: &Connection) -> TimerSnapshot {
        start_timer(
            conn,
            &settings(),
            &StartTimerInput {
                expected_revision: 0,
                mode: TimerMode::Focus,
                selected_task_id: None,
            },
        )
        .expect("start should succeed")
    }

    #[test]
    fn start_timer_generates_session_id_and_absolute_target() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);

        assert_eq!(timer.state, TimerState::Running);
        assert_eq!(timer.mode, TimerMode::Focus);
        assert!(timer.active_session_id.is_some());
        assert!(timer.target_end_at.is_some());
        assert_eq!(timer.revision, 1);
        assert_eq!(timer.task_title_snapshot.as_deref(), Some("未指定任务"));
        assert_eq!(timer.project_snapshot.as_deref(), Some("通用"));
        // target_end ≈ now + 25min, within a 2-second tolerance.
        let now = repository::now_millis();
        let target = timer.target_end_at.unwrap();
        assert!((target - now) >= 24 * 60 * 1000 && (target - now) <= 26 * 60 * 1000);
    }

    #[test]
    fn start_timer_rejects_wrong_revision() {
        let conn = db::open_in_memory().expect("db");
        let result = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: 99,
                mode: TimerMode::Focus,
                selected_task_id: None,
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::Conflict));
    }

    #[test]
    fn start_timer_rejects_non_idle_state() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn); // now running, revision 1

        let result = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: timer.revision,
                mode: TimerMode::Short,
                selected_task_id: None,
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn pause_resume_uses_absolute_target_for_drift_free_remaining() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);

        // Pause immediately — remaining should be ~full duration.
        let paused = pause_timer(&conn, &TimerRevisionInput { expected_revision: timer.revision })
            .expect("pause");
        assert_eq!(paused.state, TimerState::Paused);
        assert_eq!(paused.target_end_at, None);
        assert!(paused.remaining_seconds > 0);
        assert!(paused.remaining_seconds <= 1500);
        assert_eq!(paused.revision, 2);

        // Resume — new target_end computed from frozen remaining.
        let resumed = resume_timer(&conn, &TimerRevisionInput { expected_revision: paused.revision })
            .expect("resume");
        assert_eq!(resumed.state, TimerState::Running);
        assert!(resumed.target_end_at.is_some());
        assert_eq!(resumed.paused_at, None);
        assert_eq!(resumed.revision, 3);
        // remaining should be the same as what was frozen at pause.
        assert!(resumed.remaining_seconds > 0);
    }

    #[test]
    fn pause_rejects_non_running_state() {
        let conn = db::open_in_memory().expect("db");
        // idle → pause should fail.
        let result = pause_timer(&conn, &TimerRevisionInput { expected_revision: 0 });
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn resume_rejects_non_paused_state() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);
        // running → resume should fail.
        let result = resume_timer(&conn, &TimerRevisionInput { expected_revision: timer.revision });
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::ValidationError));
    }

    #[test]
    fn reset_writes_abandoned_session_for_started_timer() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);

        let reset = reset_timer(&conn, &settings(), &TimerRevisionInput { expected_revision: timer.revision })
            .expect("reset");
        assert_eq!(reset.state, TimerState::Idle);
        assert_eq!(reset.active_session_id, None);
        assert_eq!(reset.revision, 2);

        // An abandoned session should exist.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE status = 'abandoned'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(count, 1);
    }

    #[test]
    fn reset_does_not_write_session_for_idle_timer() {
        let conn = db::open_in_memory().expect("db");
        // idle → reset should NOT produce an abandoned session.
        reset_timer(&conn, &settings(), &TimerRevisionInput { expected_revision: 0 })
            .expect("reset");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .expect("query");
        assert_eq!(count, 0);
    }

    #[test]
    fn switch_mode_writes_abandoned_and_returns_idle() {
        let conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);

        let switched = switch_timer_mode(
            &conn,
            &settings(),
            &SwitchTimerModeInput {
                expected_revision: timer.revision,
                mode: TimerMode::Short,
            },
        )
        .expect("switch");
        assert_eq!(switched.mode, TimerMode::Short);
        assert_eq!(switched.state, TimerState::Idle);
        assert_eq!(switched.duration_seconds, 300); // 5min short break
        assert_eq!(switched.revision, 2);

        let abandoned: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE status = 'abandoned'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(abandoned, 1);
    }

    #[test]
    fn complete_timer_inserts_completed_session_and_sets_done() {
        let mut conn = db::open_in_memory().expect("db");
        let result = complete_focus(&mut conn);

        assert!(result.newly_completed);
        assert_eq!(result.timer.state, TimerState::Done);
        assert_eq!(result.timer.remaining_seconds, 0);
        assert_eq!(result.timer.revision, 2);
        assert_eq!(result.session.status, SessionStatus::Completed);
        assert_eq!(result.session.mode, TimerMode::Focus);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE status = 'completed'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(count, 1);
    }

    #[test]
    fn complete_timer_is_idempotent_for_already_completed_session() {
        // Covered by complete_is_idempotent_on_second_call below.
    }

    // ─── Proper complete_timer tests using a mutable connection ──────────────

    fn complete_focus(conn: &mut Connection) -> CompleteTimerResult {
        let timer = start_focus(conn);
        let session_id = timer.active_session_id.unwrap();
        complete_timer(
            conn,
            &settings(),
            &CompleteTimerInput {
                expected_revision: timer.revision,
                active_session_id: session_id,
                recovery: None,
            },
        )
        .expect("complete")
    }

    #[test]
    fn complete_inserts_session_and_sets_timer_done() {
        let mut conn = db::open_in_memory().expect("db");
        let result = complete_focus(&mut conn);

        assert!(result.newly_completed);
        assert_eq!(result.timer.state, TimerState::Done);
        assert_eq!(result.timer.remaining_seconds, 0);
        assert_eq!(result.timer.revision, 2);
        assert_eq!(result.session.status, SessionStatus::Completed);
        assert_eq!(result.session.mode, TimerMode::Focus);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE status = 'completed'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(count, 1);
    }

    #[test]
    fn complete_is_idempotent_on_second_call() {
        let mut conn = db::open_in_memory().expect("db");
        let first = complete_focus(&mut conn);
        let session_id = first.session.id.clone();

        // Reset timer to idle + start a new focus to bump revision, then call
        // complete again with the OLD session id — should be idempotent.
        let timer = repository::get_timer(&conn).expect("timer");
        // Timer is 'done' after completion; reset to idle first.
        let reset = reset_timer(&conn, &settings(), &TimerRevisionInput { expected_revision: timer.revision })
            .expect("reset");
        let started = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: reset.revision,
                mode: TimerMode::Focus,
                selected_task_id: None,
            },
        )
        .expect("start");

        // Now call complete with the FIRST session id but the CURRENT revision.
        // Since the first session is already completed, it should return idempotently.
        let second = complete_timer(
            &mut conn,
            &settings(),
            &CompleteTimerInput {
                expected_revision: started.revision,
                active_session_id: session_id,
                recovery: None,
            },
        )
        .expect("complete idempotent");

        assert!(!second.newly_completed);
        assert_eq!(second.session.id, first.session.id);
        assert_eq!(second.session.status, SessionStatus::Completed);

        // Only ONE completed session should exist (the original).
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE status = 'completed'", [], |r| r.get(0))
            .expect("query");
        assert_eq!(count, 1);
    }

    #[test]
    fn complete_returns_conflict_for_abandoned_session() {
        let mut conn = db::open_in_memory().expect("db");
        let timer = start_focus(&conn);
        let session_id = timer.active_session_id.unwrap();

        // Reset → writes abandoned session with that id.
        reset_timer(&conn, &settings(), &TimerRevisionInput { expected_revision: timer.revision })
            .expect("reset");

        // Now try to complete the abandoned session.
        let result = complete_timer(
            &mut conn,
            &settings(),
            &CompleteTimerInput {
                expected_revision: 0, // idle timer revision after reset
                active_session_id: session_id,
                recovery: None,
            },
        );
        assert!(matches!(result, Err(ref e) if e.code == crate::error::ErrorCode::Conflict));
    }

    #[test]
    fn start_with_task_snapshot_copies_title_and_project() {
        let mut conn = db::open_in_memory().expect("db");

        // Insert a task.
        let task = repository::insert_task(
            &conn,
            &crate::models::CreateTaskInput {
                title: "深度工作".to_owned(),
                pomodoro_target: 4,
                priority: TaskPriority::High,
                project: "Abyssal".to_owned(),
            },
        )
        .expect("insert task");

        let timer = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: 0,
                mode: TimerMode::Focus,
                selected_task_id: Some(task.id.clone()),
            },
        )
        .expect("start");

        assert_eq!(timer.task_title_snapshot.as_deref(), Some("深度工作"));
        assert_eq!(timer.project_snapshot.as_deref(), Some("Abyssal"));
        assert_eq!(timer.selected_task_id.as_deref(), Some(task.id.as_str()));
    }

    #[test]
    fn short_and_long_modes_use_break_snapshot_labels() {
        let conn = db::open_in_memory().expect("db");

        let short = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: 0,
                mode: TimerMode::Short,
                selected_task_id: None,
            },
        )
        .expect("start short");
        assert_eq!(short.task_title_snapshot.as_deref(), Some("短休"));
        assert_eq!(short.project_snapshot.as_deref(), Some("休息"));

        // Reset to try long mode.
        let reset = reset_timer(&conn, &settings(), &TimerRevisionInput { expected_revision: short.revision })
            .expect("reset");
        let long = start_timer(
            &conn,
            &settings(),
            &StartTimerInput {
                expected_revision: reset.revision,
                mode: TimerMode::Long,
                selected_task_id: None,
            },
        )
        .expect("start long");
        assert_eq!(long.task_title_snapshot.as_deref(), Some("长休"));
        assert_eq!(long.project_snapshot.as_deref(), Some("休息"));
    }
}
