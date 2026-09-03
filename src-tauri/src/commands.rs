use std::sync::MutexGuard;

use rusqlite::Connection;
use tauri::State;

use crate::error::CommandError;
use crate::models::{BootstrapPayload, CreateTaskInput, Task, UpdateTaskInput};
use crate::repository;
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
