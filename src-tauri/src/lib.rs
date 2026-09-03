use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub mod db;
pub mod error;
pub mod models;

/// Managed Tauri state: the single SQLite connection shared by every command.
pub struct AppState {
    pub db: Mutex<Connection>,
}

#[tauri::command]
fn health_check() -> String {
    "ok".to_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("abyssal-reverie.sqlite");
            let conn = db::open_at(&db_path)?;
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![health_check])
        .run(tauri::generate_context!())
        .expect("failed to run Abyssal Reverie");
}
