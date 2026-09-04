mod bibtex;
mod compile;
mod latexdiff;
mod project;
mod table;
mod tree;
mod watch;

use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use tokio_stream::{Stream, StreamExt};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

/// Generic error type for API handlers.
pub(crate) struct AppError(pub StatusCode, pub String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError(StatusCode::BAD_REQUEST, format!("IO-Fehler: {e}"))
    }
}

pub(crate) type ApiResult<T> = Result<T, AppError>;

/// Copies the current content of `path` to `path.bak` (overwriting any
/// previous backup) before it gets modified or removed. A no-op if the
/// file doesn't exist yet (nothing to back up, e.g. on first save of a
/// brand-new file). Backup failures are logged but never block the actual
/// operation — a missing backup is preferable to blocking the user's save.
fn backup_before_change(path: &Path) {
    if !path.is_file() {
        return;
    }
    let mut bak_name = path.as_os_str().to_os_string();
    bak_name.push(".bak");
    let bak_path = PathBuf::from(bak_name);
    if let Err(e) = std::fs::copy(path, &bak_path) {
        eprintln!("Warnung: Backup für {} konnte nicht erstellt werden: {e}", path.display());
    }
}

#[tokio::main]
async fn main() {
    // Ensure the folder that stores saved project files exists.
    std::fs::create_dir_all("projects").ok();

    let app = Router::new()
        .route("/api/tree", get(get_tree))
        .route("/api/browse", get(browse_dirs))
        .route("/api/watch", get(watch_dir_sse))
        .route("/api/folder/create", axum::routing::post(create_folder))
        .route("/api/file", get(get_file).post(save_file))
        .route("/api/file/create", axum::routing::post(create_file))
        .route("/api/file/rename", axum::routing::post(rename_file))
        .route("/api/file/delete", axum::routing::post(delete_file))
        .route("/api/compile", axum::routing::post(compile_tex))
        .route("/api/latexdiff", axum::routing::post(run_latexdiff_handler))
        .route("/api/pdf", get(get_pdf))
        .route("/api/image", get(get_image))
        .route("/api/table", get(get_table))
        .route("/api/bib", get(get_bib))
        .route("/api/bib/entry", axum::routing::post(update_bib_entry))
        .route("/api/bib/entry/create", axum::routing::post(create_bib_entry))
        .route("/api/bib/entry/delete", axum::routing::post(delete_bib_entry))
        .route("/api/project/save", axum::routing::post(project::save_project))
        .route("/api/project/load", get(project::load_project))
        .route("/api/project/list", get(project::list_projects))
        .fallback_service(ServeDir::new("static"))
        .layer(CorsLayer::permissive());

    let addr = "0.0.0.0:3000";
    println!("LaTeX-Projekt-Server läuft auf http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ---------- /api/tree ----------

#[derive(Deserialize)]
struct DirQuery {
    dir: String,
}

async fn get_tree(Query(q): Query<DirQuery>) -> ApiResult<Json<tree::TreeNode>> {
    let base = PathBuf::from(&q.dir);
    if !base.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Arbeitsordner nicht gefunden: {}", q.dir),
        ));
    }
    let node = tree::build_tree(&base, 0)?;
    Ok(Json(node))
}

// ---------- /api/browse (Ordnerauswahl-Dialog) ----------

#[derive(Deserialize)]
struct BrowseQuery {
    dir: Option<String>,
}

#[derive(Serialize)]
struct BrowseEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct BrowseResponse {
    current: String,
    parent: Option<String>,
    dirs: Vec<BrowseEntry>,
}

/// Lists the subdirectories of the given directory (or the user's home
/// directory / filesystem root if none is given), for the folder-picker
/// dialog in the frontend. Only directories are returned — files are
/// irrelevant when choosing a working folder.
async fn browse_dirs(Query(q): Query<BrowseQuery>) -> ApiResult<Json<BrowseResponse>> {
    let start = q.dir.unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    });
    let path = PathBuf::from(&start);
    if !path.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Ordner nicht gefunden: {start}"),
        ));
    }

    let canonical = std::fs::canonicalize(&path).unwrap_or(path);
    let parent = canonical
        .parent()
        .filter(|_| canonical.to_string_lossy() != "/")
        .map(|p| p.to_string_lossy().to_string());

    let mut dirs: Vec<BrowseEntry> = std::fs::read_dir(&canonical)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !is_hidden(p))
        .map(|p| BrowseEntry {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
        })
        .collect();
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(Json(BrowseResponse {
        current: canonical.to_string_lossy().to_string(),
        parent,
        dirs,
    }))
}

// ---------- /api/watch (Server-Sent Events: Dateisystem-Überwachung) ----------

#[derive(Deserialize)]
struct WatchQuery {
    dir: String,
}

/// Öffnet eine SSE-Verbindung, die ein "change"-Ereignis sendet, sobald
/// sich innerhalb von `dir` (rekursiv) etwas auf dem Dateisystem ändert.
/// Das Frontend nutzt dies, um den Ordnerbaum automatisch zu aktualisieren,
/// ohne dass der Nutzer manuell neu laden muss.
async fn watch_dir_sse(
    Query(q): Query<WatchQuery>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let dir = PathBuf::from(&q.dir);
    if !dir.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Ordner nicht gefunden: {}", q.dir),
        ));
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<()>(4);

    // notify's Watcher ist nicht async; er läuft daher in einem eigenen
    // blockierenden Thread und meldet Änderungen über den Kanal zurück.
    tokio::task::spawn_blocking(move || {
        watch::watch_directory(&dir, tx);
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(|_| Ok(Event::default().event("change").data("changed")));

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ---------- /api/folder/create ----------

#[derive(Deserialize)]
struct CreateFolderBody {
    /// Verzeichnis, in dem der neue Ordner angelegt werden soll.
    dir: String,
    name: String,
}

async fn create_folder(Json(body): Json<CreateFolderBody>) -> ApiResult<Json<serde_json::Value>> {
    let dir = PathBuf::from(&body.dir);
    if !dir.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Zielordner nicht gefunden: {}", body.dir),
        ));
    }

    let raw_name = body.name.trim();
    if raw_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Ordnername darf nicht leer sein.".into()));
    }
    if raw_name.contains('/') || raw_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Ordnername darf keine Pfadtrenner enthalten.".into(),
        ));
    }

    let target = dir.join(raw_name);
    if target.exists() {
        return Err(AppError(
            StatusCode::CONFLICT,
            format!("Es existiert bereits etwas mit diesem Namen: {}", target.display()),
        ));
    }

    std::fs::create_dir(&target)?;
    Ok(Json(serde_json::json!({ "ok": true, "path": target.to_string_lossy() })))
}

// ---------- /api/file ----------

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

async fn get_file(Query(q): Query<PathQuery>) -> ApiResult<String> {
    let content = std::fs::read_to_string(&q.path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("Datei konnte nicht gelesen werden ({}): {e}", q.path),
        )
    })?;
    Ok(content)
}

#[derive(Deserialize)]
struct SaveFileBody {
    path: String,
    content: String,
}

async fn save_file(Json(body): Json<SaveFileBody>) -> ApiResult<Json<serde_json::Value>> {
    let path = PathBuf::from(&body.path);
    backup_before_change(&path); // .bak der bisherigen Version, bevor überschrieben wird
    std::fs::write(&path, &body.content)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- /api/file/create ----------

#[derive(Deserialize)]
struct CreateFileBody {
    /// Directory the new file should be created in.
    dir: String,
    /// Desired file name. If it has no extension, ".tex" is appended.
    name: String,
}

async fn create_file(Json(body): Json<CreateFileBody>) -> ApiResult<Json<serde_json::Value>> {
    let dir = PathBuf::from(&body.dir);
    if !dir.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Zielordner nicht gefunden: {}", body.dir),
        ));
    }

    let raw_name = body.name.trim();
    if raw_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Dateiname darf nicht leer sein.".into()));
    }
    if raw_name.contains('/') || raw_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Dateiname darf keine Pfadtrenner enthalten.".into(),
        ));
    }

    let name = if Path::new(raw_name).extension().is_some() {
        raw_name.to_string()
    } else {
        format!("{raw_name}.tex")
    };

    let target = dir.join(&name);
    if target.exists() {
        return Err(AppError(
            StatusCode::CONFLICT,
            format!("Datei existiert bereits: {}", target.display()),
        ));
    }

    // New .tex files start with a minimal, compilable document skeleton so
    // the user has something sensible to work with right away.
    let initial_content = if name.to_lowercase().ends_with(".tex") {
        "\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\n\\begin{document}\n\n\\end{document}\n"
    } else {
        ""
    };

    std::fs::write(&target, initial_content)?;
    Ok(Json(serde_json::json!({ "ok": true, "path": target.to_string_lossy() })))
}

// ---------- /api/file/rename ----------

#[derive(Deserialize)]
struct RenameFileBody {
    path: String,
    new_name: String,
}

async fn rename_file(Json(body): Json<RenameFileBody>) -> ApiResult<Json<serde_json::Value>> {
    let old_path = PathBuf::from(&body.path);
    if !old_path.exists() {
        return Err(AppError(
            StatusCode::NOT_FOUND,
            format!("Datei/Ordner nicht gefunden: {}", body.path),
        ));
    }

    let new_name = body.new_name.trim();
    if new_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Neuer Name darf nicht leer sein.".into()));
    }
    if new_name.contains('/') || new_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Name darf keine Pfadtrenner enthalten.".into(),
        ));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| AppError(StatusCode::BAD_REQUEST, "Kein übergeordneter Ordner gefunden.".into()))?;
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err(AppError(
            StatusCode::CONFLICT,
            format!("Es existiert bereits etwas mit dem Namen: {new_name}"),
        ));
    }

    std::fs::rename(&old_path, &new_path)?;
    Ok(Json(serde_json::json!({ "ok": true, "path": new_path.to_string_lossy() })))
}

// ---------- /api/file/delete ----------

#[derive(Deserialize)]
struct DeleteFileBody {
    path: String,
}

async fn delete_file(Json(body): Json<DeleteFileBody>) -> ApiResult<Json<serde_json::Value>> {
    let path = PathBuf::from(&body.path);
    if !path.exists() {
        return Err(AppError(
            StatusCode::NOT_FOUND,
            format!("Datei/Ordner nicht gefunden: {}", body.path),
        ));
    }

    if path.is_dir() {
        // Ein rekursives .bak eines ganzen Ordners ist nicht sinnvoll abbildbar
        // (kein einzelner Dateiname) — hier gibt es daher kein Backup.
        std::fs::remove_dir_all(&path)?;
    } else {
        backup_before_change(&path); // Inhalt bleibt als .bak erhalten, falls versehentlich gelöscht
        std::fs::remove_file(&path)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- /api/compile ----------

#[derive(Deserialize)]
struct CompileBody {
    path: String,
}

#[derive(Serialize)]
struct CompileResponse {
    success: bool,
    errors: Vec<compile::CompileIssue>,
    warnings: Vec<compile::CompileIssue>,
    log: String,
    pdf_path: Option<String>,
}

async fn compile_tex(Json(body): Json<CompileBody>) -> ApiResult<Json<CompileResponse>> {
    let tex_path = PathBuf::from(&body.path);
    if !tex_path.is_file() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("LaTeX-Datei nicht gefunden: {}", body.path),
        ));
    }

    let result = tokio::task::spawn_blocking(move || compile::run_compile(&tex_path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task-Fehler: {e}")))??;

    Ok(Json(CompileResponse {
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
        log: result.log,
        pdf_path: result.pdf_path.map(|p| p.to_string_lossy().to_string()),
    }))
}

// ---------- /api/latexdiff ----------

#[derive(Deserialize)]
struct LatexDiffBody {
    /// Pfad der im Arbeitsordner ausgewählten (Vergleichs-)Datei.
    old_path: String,
    /// Pfad der aktuell im Editor geöffneten (neuen) Datei.
    new_path: String,
}

#[derive(Serialize)]
struct LatexDiffResponse {
    success: bool,
    diff_path: Option<String>,
    log: String,
}

async fn run_latexdiff_handler(Json(body): Json<LatexDiffBody>) -> ApiResult<Json<LatexDiffResponse>> {
    let old_path = PathBuf::from(&body.old_path);
    let new_path = PathBuf::from(&body.new_path);

    if !old_path.is_file() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Ausgewählte Datei nicht gefunden: {}", body.old_path),
        ));
    }
    if !new_path.is_file() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Editor-Datei nicht gefunden: {}", body.new_path),
        ));
    }
    if old_path == new_path {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Bitte im Arbeitsordner eine andere Datei als die im Editor geöffnete auswählen.".into(),
        ));
    }

    let result = tokio::task::spawn_blocking(move || latexdiff::run_latexdiff(&old_path, &new_path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task-Fehler: {e}")))?;

    Ok(Json(LatexDiffResponse {
        success: result.success,
        diff_path: result.diff_path.map(|p| p.to_string_lossy().to_string()),
        log: result.log,
    }))
}

// ---------- /api/pdf ----------

async fn get_pdf(Query(q): Query<PathQuery>) -> ApiResult<Response> {
    let path = PathBuf::from(&q.path);
    let bytes = std::fs::read(&path).map_err(|e| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("PDF nicht gefunden ({}): {e}", q.path),
        )
    })?;

    // "inline" weist den Browser explizit an, die PDF direkt anzuzeigen
    // statt sie herunterzuladen. Ohne diesen Header überlässt man die
    // Entscheidung der Browser-Heuristik, die je nach Einstellungen,
    // Erweiterungen oder Browser-Version inkonsistent ausfallen kann.
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dokument.pdf");
    let disposition = format!("inline; filename=\"{}\"", file_name.replace('"', "'"));

    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        bytes,
    )
        .into_response())
}

// ---------- /api/image ----------

async fn get_image(Query(q): Query<PathQuery>) -> ApiResult<Response> {
    let path = PathBuf::from(&q.path);
    let content_type = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => {
            return Err(AppError(
                StatusCode::BAD_REQUEST,
                "Keine unterstützte Bilddatei.".into(),
            ))
        }
    };

    let bytes = std::fs::read(&path).map_err(|e| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Bild nicht gefunden ({}): {e}", q.path),
        )
    })?;
    Ok((
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CONTENT_DISPOSITION, "inline".to_string()),
        ],
        bytes,
    )
        .into_response())
}

// ---------- /api/table ----------

async fn get_table(Query(q): Query<PathQuery>) -> ApiResult<Json<table::TableResult>> {
    let path = PathBuf::from(&q.path);
    if !path.is_file() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Tabellendatei nicht gefunden: {}", q.path),
        ));
    }

    let result = tokio::task::spawn_blocking(move || table::read_table(&path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task-Fehler: {e}")))?
        .map_err(|e| AppError(StatusCode::BAD_REQUEST, e))?;

    Ok(Json(result))
}

// ---------- /api/bib ----------

async fn get_bib(Query(q): Query<PathQuery>) -> ApiResult<Json<Vec<bibtex::BibEntry>>> {
    let content = std::fs::read_to_string(&q.path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("BibTeX-Datei konnte nicht gelesen werden ({}): {e}", q.path),
        )
    })?;
    let entries = bibtex::parse_bib(&content);
    Ok(Json(entries))
}

// ---------- /api/bib/entry/create (neuen Eintrag anlegen) ----------

#[derive(Deserialize)]
struct BibEntryCreateBody {
    bib_path: String,
    /// Roher BibTeX-Quelltext des neuen Eintrags, z.B. "@article{key, ...}".
    raw: String,
}

async fn create_bib_entry(Json(body): Json<BibEntryCreateBody>) -> ApiResult<Json<serde_json::Value>> {
    let raw = body.raw.trim();
    if raw.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Der Eintrag darf nicht leer sein.".into()));
    }

    let bib_path = PathBuf::from(&body.bib_path);

    // Falls die Datei noch nicht existiert, wird sie hier neu angelegt
    // (leerer Ausgangsinhalt); std::fs::write erstellt sie automatisch.
    let existing = std::fs::read_to_string(&bib_path).unwrap_or_default();

    let mut new_content = existing;
    if !new_content.is_empty() {
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push('\n'); // Leerzeile als Trenner zum vorherigen Eintrag
    }
    new_content.push_str(raw);
    new_content.push('\n');

    backup_before_change(&bib_path); // .bak der Datei vor dem Anhängen des neuen Eintrags
    std::fs::write(&bib_path, new_content)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- /api/bib/entry (Eintrag bearbeiten) ----------

#[derive(Deserialize)]
struct BibEntryUpdateBody {
    bib_path: String,
    /// Key of the entry as it currently exists in the file (used to find it).
    original_key: String,
    /// New raw BibTeX source for this entry (e.g. "@book{key, title = {...}, ...}").
    raw: String,
}

async fn update_bib_entry(Json(body): Json<BibEntryUpdateBody>) -> ApiResult<Json<serde_json::Value>> {
    let content = std::fs::read_to_string(&body.bib_path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("BibTeX-Datei konnte nicht gelesen werden ({}): {e}", body.bib_path),
        )
    })?;

    let entries = bibtex::parse_bib(&content);
    let entry = entries.iter().find(|e| e.key == body.original_key).ok_or_else(|| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Eintrag '{}' wurde in der Datei nicht gefunden.", body.original_key),
        )
    })?;

    let pos = content.find(entry.raw.as_str()).ok_or_else(|| {
        AppError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Der Eintrag konnte im Dateiinhalt nicht eindeutig lokalisiert werden.".into(),
        )
    })?;

    let mut new_content = String::with_capacity(content.len() - entry.raw.len() + body.raw.len());
    new_content.push_str(&content[..pos]);
    new_content.push_str(&body.raw);
    new_content.push_str(&content[pos + entry.raw.len()..]);

    backup_before_change(&PathBuf::from(&body.bib_path)); // .bak der Datei vor dem Bearbeiten
    std::fs::write(&body.bib_path, new_content)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- /api/bib/entry/delete ----------

#[derive(Deserialize)]
struct BibEntryDeleteBody {
    bib_path: String,
    key: String,
}

async fn delete_bib_entry(Json(body): Json<BibEntryDeleteBody>) -> ApiResult<Json<serde_json::Value>> {
    let content = std::fs::read_to_string(&body.bib_path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("BibTeX-Datei konnte nicht gelesen werden ({}): {e}", body.bib_path),
        )
    })?;

    let entries = bibtex::parse_bib(&content);
    let entry = entries.iter().find(|e| e.key == body.key).ok_or_else(|| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Eintrag '{}' wurde in der Datei nicht gefunden.", body.key),
        )
    })?;

    let pos = content.find(entry.raw.as_str()).ok_or_else(|| {
        AppError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Der Eintrag konnte im Dateiinhalt nicht eindeutig lokalisiert werden.".into(),
        )
    })?;

    let mut new_content = String::with_capacity(content.len());
    new_content.push_str(&content[..pos]);
    new_content.push_str(&content[pos + entry.raw.len()..]);

    backup_before_change(&PathBuf::from(&body.bib_path)); // .bak der Datei vor dem Löschen des Eintrags
    std::fs::write(&body.bib_path, new_content)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// Small helper kept here so other modules can share it without a circular import.
pub(crate) fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}
