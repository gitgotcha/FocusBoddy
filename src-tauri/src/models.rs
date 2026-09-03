use serde::{Deserialize, Serialize};

// ─── Enums ───────────────────────────────────────────────────────────────────
// Each enum round-trips through SQLite as TEXT and through IPC as lowercase.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    High,
    Med,
    Low,
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskPriority::High => "high",
            TaskPriority::Med => "med",
            TaskPriority::Low => "low",
        }
    }

    pub fn parse_str(value: &str) -> Option<Self> {
        match value {
            "high" => Some(TaskPriority::High),
            "med" => Some(TaskPriority::Med),
            "low" => Some(TaskPriority::Low),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerMode {
    Focus,
    Short,
    Long,
}

impl TimerMode {
    pub fn as_str(self) -> &'static str {
        match self {
            TimerMode::Focus => "focus",
            TimerMode::Short => "short",
            TimerMode::Long => "long",
        }
    }

    pub fn parse_str(value: &str) -> Option<Self> {
        match value {
            "focus" => Some(TimerMode::Focus),
            "short" => Some(TimerMode::Short),
            "long" => Some(TimerMode::Long),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerState {
    Idle,
    Running,
    Paused,
    Done,
}

impl TimerState {
    pub fn as_str(self) -> &'static str {
        match self {
            TimerState::Idle => "idle",
            TimerState::Running => "running",
            TimerState::Paused => "paused",
            TimerState::Done => "done",
        }
    }

    pub fn parse_str(value: &str) -> Option<Self> {
        match value {
            "idle" => Some(TimerState::Idle),
            "running" => Some(TimerState::Running),
            "paused" => Some(TimerState::Paused),
            "done" => Some(TimerState::Done),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Completed,
    Abandoned,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Completed => "completed",
            SessionStatus::Abandoned => "abandoned",
        }
    }

    pub fn parse_str(value: &str) -> Option<Self> {
        match value {
            "completed" => Some(SessionStatus::Completed),
            "abandoned" => Some(SessionStatus::Abandoned),
            _ => None,
        }
    }
}

// ─── Persisted records ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub pomodoro_target: i64,
    pub priority: TaskPriority,
    pub project: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub focus_duration_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub auto_start_break: bool,
    pub sound_enabled: bool,
    pub notification_enabled: bool,
    pub daily_goal: i64,
    pub updated_at: i64,
}

impl Default for AppSettings {
    /// Mirrors `DEFAULT_SETTINGS` in `src/domain/defaults.ts`.
    fn default() -> Self {
        Self {
            focus_duration_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            auto_start_break: false,
            sound_enabled: true,
            notification_enabled: true,
            daily_goal: 8,
            updated_at: 0,
        }
    }
}

impl AppSettings {
    pub fn duration_seconds_for_mode(&self, mode: TimerMode) -> i64 {
        let minutes = match mode {
            TimerMode::Focus => self.focus_duration_minutes,
            TimerMode::Short => self.short_break_minutes,
            TimerMode::Long => self.long_break_minutes,
        };
        minutes * 60
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSnapshot {
    pub mode: TimerMode,
    pub state: TimerState,
    pub active_session_id: Option<String>,
    pub selected_task_id: Option<String>,
    pub task_title_snapshot: Option<String>,
    pub project_snapshot: Option<String>,
    pub duration_seconds: i64,
    pub remaining_seconds: i64,
    pub started_at: Option<i64>,
    pub target_end_at: Option<i64>,
    pub paused_at: Option<i64>,
    pub revision: i64,
    pub updated_at: i64,
}

impl TimerSnapshot {
    /// Mirrors `idleTimerForMode()` in `src/domain/defaults.ts`.
    pub fn idle(mode: TimerMode, duration_seconds: i64) -> Self {
        Self {
            mode,
            state: TimerState::Idle,
            active_session_id: None,
            selected_task_id: None,
            task_title_snapshot: None,
            project_snapshot: None,
            duration_seconds,
            remaining_seconds: duration_seconds,
            started_at: None,
            target_end_at: None,
            paused_at: None,
            revision: 0,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSession {
    pub id: String,
    pub task_id: Option<String>,
    pub task_title_snapshot: String,
    pub project_snapshot: String,
    pub mode: TimerMode,
    pub status: SessionStatus,
    pub planned_seconds: i64,
    pub focused_seconds: i64,
    pub started_at: i64,
    pub ended_at: i64,
}

// ─── Statistics payloads ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsDayBoundary {
    pub date: String,
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub date: String,
    pub sessions: i64,
    pub focus_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStat {
    pub project: String,
    pub sessions: i64,
    pub focus_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub from: i64,
    pub to: i64,
    pub focus_session_count: i64,
    pub focus_seconds: i64,
    pub daily_goal: i64,
    pub streak_days: i64,
    pub best_day: Option<String>,
    pub by_day: Vec<DayStat>,
    pub by_project: Vec<ProjectStat>,
}

// ─── Command payloads ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub pomodoro_target: i64,
    pub priority: TaskPriority,
    pub project: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub pomodoro_target: Option<i64>,
    pub priority: Option<TaskPriority>,
    pub project: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub tasks: Vec<Task>,
    pub settings: AppSettings,
    pub timer: TimerSnapshot,
    pub sessions: Vec<TimerSession>,
    pub statistics: Statistics,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_serialize_to_the_frontend_strings() {
        assert_eq!(serde_json::to_value(TaskPriority::Med).unwrap(), "med");
        assert_eq!(serde_json::to_value(TaskPriority::High).unwrap(), "high");
        assert_eq!(serde_json::to_value(TimerMode::Short).unwrap(), "short");
        assert_eq!(serde_json::to_value(TimerMode::Long).unwrap(), "long");
        assert_eq!(serde_json::to_value(TimerState::Paused).unwrap(), "paused");
        assert_eq!(serde_json::to_value(SessionStatus::Abandoned).unwrap(), "abandoned");
    }

    #[test]
    fn enums_round_trip_through_their_text_representation() {
        for (text, priority) in [("high", TaskPriority::High), ("med", TaskPriority::Med), ("low", TaskPriority::Low)] {
            assert_eq!(priority.as_str(), text);
            assert_eq!(TaskPriority::parse_str(text), Some(priority));
        }
        assert_eq!(TimerMode::parse_str("focus"), Some(TimerMode::Focus));
        assert_eq!(TimerState::parse_str("done"), Some(TimerState::Done));
        assert_eq!(SessionStatus::parse_str("nope"), None);
    }

    #[test]
    fn timer_snapshot_uses_camel_case_keys() {
        let snapshot = TimerSnapshot::idle(TimerMode::Focus, 1500);
        let json = serde_json::to_value(&snapshot).expect("serializable");

        assert_eq!(json["mode"], "focus");
        assert_eq!(json["state"], "idle");
        assert_eq!(json["durationSeconds"], 1500);
        assert_eq!(json["remainingSeconds"], 1500);
        assert_eq!(json["revision"], 0);
        assert!(json.get("activeSessionId").is_some(), "expected activeSessionId key");
        assert!(json.get("targetEndAt").is_some(), "expected targetEndAt key");
        assert!(json["startedAt"].is_null());
    }

    #[test]
    fn default_settings_match_the_frontend_defaults() {
        let settings = AppSettings::default();

        assert_eq!(settings.focus_duration_minutes, 25);
        assert_eq!(settings.short_break_minutes, 5);
        assert_eq!(settings.long_break_minutes, 15);
        assert!(!settings.auto_start_break);
        assert!(settings.sound_enabled);
        assert!(settings.notification_enabled);
        assert_eq!(settings.daily_goal, 8);
        assert_eq!(settings.duration_seconds_for_mode(TimerMode::Focus), 1500);
        assert_eq!(settings.duration_seconds_for_mode(TimerMode::Short), 300);
        assert_eq!(settings.duration_seconds_for_mode(TimerMode::Long), 900);
    }

    #[test]
    fn task_deserializes_from_the_frontend_payload() {
        let json = serde_json::json!({
            "id": "task-1",
            "title": "Write the spec",
            "done": false,
            "pomodoroTarget": 4,
            "priority": "high",
            "project": "Abyssal Reverie",
            "sortOrder": 2,
            "createdAt": 1,
            "updatedAt": 2,
            "completedAt": null,
        });

        let task: Task = serde_json::from_value(json).expect("deserializable");

        assert_eq!(task.pomodoro_target, 4);
        assert_eq!(task.priority, TaskPriority::High);
        assert_eq!(task.sort_order, 2);
        assert_eq!(task.completed_at, None);
    }
}
