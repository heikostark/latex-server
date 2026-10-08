use crate::{AppError, ApiResult};
use axum::extract::Query;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub name: String,
    pub working_dir: String,
    #[serde(default)]
    pub tex_file: Option<String>,
    #[serde(default)]
    pub bib_file: Option<String>,
}

fn project_file_path(name: &str) -> PathBuf {
    // Sanitize the name to avoid path traversal via project names.
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect();
    crate::projects_dir().join(format!("{}.json", safe.trim()))
}

pub async fn save_project(Json(config): Json<ProjectConfig>) -> ApiResult<Json<serde_json::Value>> {
    if config.name.trim().is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Project name must not be empty.".into()));
    }
    std::fs::create_dir_all(crate::projects_dir())?;
    let path = project_file_path(&config.name);
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Serialization error: {e}")))?;
    std::fs::write(path, json)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LoadQuery {
    name: String,
}

pub async fn load_project(Query(q): Query<LoadQuery>) -> ApiResult<Json<ProjectConfig>> {
    let path = project_file_path(&q.name);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| AppError(StatusCode::NOT_FOUND, format!("Project '{}' not found: {e}", q.name)))?;
    let config: ProjectConfig = serde_json::from_str(&content)
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Project file is corrupt: {e}")))?;
    Ok(Json(config))
}

pub async fn list_projects() -> ApiResult<Json<Vec<String>>> {
    let dir = crate::projects_dir();
    std::fs::create_dir_all(&dir)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    Ok(Json(names))
}
