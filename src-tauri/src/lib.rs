use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;
use tauri::{Emitter, Manager, WindowEvent};

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod repository;
pub mod tray;

/// Managed Tauri state: the single SQLite connection shared by every command.
pub struct AppState {
    pub db: Mutex<Connection>,
}

#[tauri::command]
fn health_check() -> String {
    "ok".to_owned()
}

/// Pushes live tray indicator text from the frontend. The frontend owns the
/// remaining-time derivation (drift-free, from `targetEndAt`); Rust only paints
/// the tooltip and the two dynamic menu labels.
#[tauri::command]
fn set_tray_indicator(app: tauri::AppHandle, input: tray::TrayIndicator) {
    tray::apply_indicator(&app, &input);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launch focuses the existing window instead of starting
            // a second process.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("abyssal-reverie.sqlite");
            let conn = db::open_at(&db_path)?;
            app.manage(AppState { db: Mutex::new(conn) });

            tray::build_tray(app.handle())?;

            // Closing the main window hides it to the tray instead of quitting,
            // so a running focus session survives a stray close.
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // Background completion backstop: if the frontend is throttled
            // (hidden window) or suspended (system sleep), the 250ms UI tick
            // may fire `complete_timer` late. This thread reads the timer every
            // second and emits `timer-expired` the moment a running session's
            // `target_end_at` is in the past; the frontend handler then calls
            // the idempotent `complete_timer`. Read-only — no DB writes here,
            // so there is no revision race with the frontend.
            let handle = app.handle().clone();
            std::thread::spawn(move || ticker(handle));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            set_tray_indicator,
            commands::bootstrap_app,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::save_settings,
            commands::start_timer,
            commands::pause_timer,
            commands::resume_timer,
            commands::reset_timer,
            commands::switch_timer_mode,
            commands::complete_timer,
            commands::list_sessions,
            commands::get_statistics,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Abyssal Reverie");
}

/// 1 Hz read-only poll that emits `timer-expired` once per expired session.
fn ticker(app: tauri::AppHandle) {
    let mut last_emitted: Option<String> = None;
    loop {
        std::thread::sleep(Duration::from_secs(1));

        // Read the timer inside a single closure so the MutexGuard lives long
        // enough for `get_timer`; the returned snapshot is owned, so no borrow
        // escapes the closure.
        let expired = app
            .try_state::<AppState>()
            .and_then(|state| {
                let conn = state.db.lock().ok()?;
                repository::get_timer(&conn).ok()
            })
            .filter(|timer| {
                timer.state == models::TimerState::Running
                    && timer.active_session_id.is_some()
                    && timer
                        .target_end_at
                        .map(|t| t <= repository::now_millis())
                        .unwrap_or(false)
            });

        if let Some(timer) = expired {
            let id = timer.active_session_id.clone().unwrap();
            if last_emitted.as_deref() != Some(id.as_str()) {
                last_emitted = Some(id.clone());
                // Payload carries the id + revision so the frontend's
                // `handleExpire` path can call `complete_timer` directly.
                let _ = app.emit(
                    "timer-expired",
                    serde_json::json!({
                        "activeSessionId": id,
                        "expectedRevision": timer.revision,
                    }),
                );
            }
        } else {
            // Reset the dedup latch when the timer leaves the running state so
            // the next session can emit again.
            last_emitted = None;
        }
    }
}
