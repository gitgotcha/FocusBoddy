use std::sync::MutexGuard;

use rusqlite::Connection;
use tauri::State;

use crate::error::CommandError;
use crate::models::{
    AppSettings, BootstrapPayload, CompleteTimerInput, CompleteTimerResult, CreateTaskInput,
    SaveSettingsResult, StartTimerInput, SwitchTimerModeInput, Task, TimerRevisionInput,
    TimerSnapshot, UpdateTaskInput,
};
use crate::repository;
use crate::timer;
use crate::AppState;

/// How much recent history `bootstrap_app` ships to the frontend.
const BOOTSTRAP_SESSION_LIMIT: i64 = 50;

fn lock_db<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Connection>, CommandError> {
    state
        .db
        .lock()
        .map_err(|err| CommandError::internal(format!("database lock poisoned: {err}")))
}

#[tauri::command]
pub fn bootstrap_app(state: State<'_, AppState>) -> Result<BootstrapPayload, CommandError> {
    let conn = lock_db(&state)?;

    Ok(BootstrapPayload {
        tasks: repository::list_tasks(&conn)?,
        settings: repository::get_settings(&conn)?,
        timer: repository::get_timer(&conn)?,
        sessions: repository::list_sessions(&conn, BOOTSTRAP_SESSION_LIMIT)?,
        statistics: repository::all_time_statistics(&conn)?,
    })
}

#[tauri::command]
pub fn create_task(state: State<'_, AppState>, input: CreateTaskInput) -> Result<Task, CommandError> {
    let conn = lock_db(&state)?;
    repository::insert_task(&conn, &input)
}

#[tauri::command]
pub fn update_task(state: State<'_, AppState>, input: UpdateTaskInput) -> Result<Task, CommandError> {
    let conn = lock_db(&state)?;
    repository::update_task(&conn, &input)
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let conn = lock_db(&state)?;
    repository::delete_task(&conn, &id)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, input: AppSettings) -> Result<SaveSettingsResult, CommandError> {
    let conn = lock_db(&state)?;
    repository::save_settings(&conn, &input)
}

// ─── Timer state machine ─────────────────────────────────────────────────────

#[tauri::command]
pub fn start_timer(state: State<'_, AppState>, input: StartTimerInput) -> Result<TimerSnapshot, CommandError> {
    let conn = lock_db(&state)?;
    let settings = repository::get_settings(&conn)?;
    timer::start_timer(&conn, &settings, &input)
}

#[tauri::command]
pub fn pause_timer(state: State<'_, AppState>, input: TimerRevisionInput) -> Result<TimerSnapshot, CommandError> {
    let conn = lock_db(&state)?;
    timer::pause_timer(&conn, &input)
}

#[tauri::command]
pub fn resume_timer(state: State<'_, AppState>, input: TimerRevisionInput) -> Result<TimerSnapshot, CommandError> {
    let conn = lock_db(&state)?;
    timer::resume_timer(&conn, &input)
}

#[tauri::command]
pub fn reset_timer(state: State<'_, AppState>, input: TimerRevisionInput) -> Result<TimerSnapshot, CommandError> {
    let conn = lock_db(&state)?;
    let settings = repository::get_settings(&conn)?;
    timer::reset_timer(&conn, &settings, &input)
}

#[tauri::command]
pub fn switch_timer_mode(state: State<'_, AppState>, input: SwitchTimerModeInput) -> Result<TimerSnapshot, CommandError> {
    let conn = lock_db(&state)?;
    let settings = repository::get_settings(&conn)?;
    timer::switch_timer_mode(&conn, &settings, &input)
}

#[tauri::command]
pub fn complete_timer(state: State<'_, AppState>, input: CompleteTimerInput) -> Result<CompleteTimerResult, CommandError> {
    let mut conn = lock_db(&state)?;
    let settings = repository::get_settings(&conn)?;
    timer::complete_timer(&mut conn, &settings, &input)
}
