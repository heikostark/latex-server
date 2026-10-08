mod bibtex;
mod compile;
mod latexdiff;
mod project;
mod table;
mod tree;
mod watch;

use axum::{
    extract::Query,
    http::{header, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use clap::Parser;
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use tokio_stream::{Stream, StreamExt};
use tower_http::cors::CorsLayer;

/// The frontend (`static/`, including the vendored CodeMirror files) is
/// embedded into the compiled binary at build time. This way the app no
/// longer depends on the process's current working directory to find its
/// own assets — running the binary as `cargo run`, as `./latex-project-server`
/// from the project root, or as `./target/release/latex-project-server`
/// from inside `target/release/` (a natural thing to try after building)
/// all serve the exact same files. Without this, only the first of those
/// worked, since `ServeDir::new("static")` resolved "static" relative to
/// whatever directory the process happened to be started from.
static STATIC_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/static");

/// CLI arguments for configuring the server (port, host, etc.)
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// The port number the server should listen on
    #[arg(short, long, default_value_t = 3000)]
    port: u16,

    /// The host address the server should bind to (e.g. 127.0.0.1 or 0.0.0.0)
    #[arg(short, long, default_value = "127.0.0.1")]
    host: String,
}

/// Generic error type for API handlers.
pub(crate) struct AppError(pub StatusCode, pub String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError(StatusCode::BAD_REQUEST, format!("I/O error: {e}"))
    }
}

pub(crate) type ApiResult<T> = Result<T, AppError>;

/// Validates that a candidate path is within the given root directory.
/// Both paths are canonicalized to prevent symlink/.. traversal attacks.
fn ensure_within_dir(root: &Path, candidate: &Path) -> ApiResult<PathBuf> {
    let root_canonical = std::fs::canonicalize(root).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("Invalid working directory: {e}"),
        )
    })?;

    let candidate_canonical = std::fs::canonicalize(candidate).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("Invalid path: {e}"),
        )
    })?;

    if !candidate_canonical.starts_with(&root_canonical) {
        return Err(AppError(
            StatusCode::FORBIDDEN,
            format!(
                "Path is outside the working directory: {}",
                candidate_canonical.display()
            ),
        ));
    }

    Ok(candidate_canonical)
}

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
        eprintln!("Warning: backup for {} could not be created: {e}", path.display());
    }
}

/// Directory saved project configurations are written to and read from
/// (see `project.rs`). Resolved relative to the running executable's own
/// location rather than the current working directory, so it ends up in a
/// predictable, consistent place (next to the binary) no matter which
/// directory the server happens to be started from.
pub(crate) fn projects_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("projects")
}

/// Serves the embedded frontend (see `STATIC_DIR` above). Mirrors the
/// bits of `tower_http::services::ServeDir` behavior this app relies on:
/// serves `index.html` for the root path and for any path with no file
/// extension (so e.g. a trailing slash still resolves), otherwise serves
/// the exact requested file, with a content type guessed from its
/// extension.
async fn serve_embedded(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = STATIC_DIR.get_file(path) {
        let mime = static_mime_type(path);
        return ([(header::CONTENT_TYPE, mime)], file.contents()).into_response();
    }

    // Fallback to index.html for extension-less paths (e.g. a trailing
    // slash), matching ServeDir's previous behavior for this single-page app.
    if !path.contains('.') {
        if let Some(index) = STATIC_DIR.get_file("index.html") {
            return ([(header::CONTENT_TYPE, "text/html")], index.contents()).into_response();
        }
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

/// Minimal extension-to-MIME-type mapping for the file types that exist
/// under `static/` (the frontend, including the vendored CodeMirror
/// files). Deliberately not a general-purpose MIME database.
fn static_mime_type(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("map") => "application/json",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[tokio::main]
async fn main() {
    // Parse CLI arguments
    let args = Args::parse();

    // Ensure the folder that stores saved project files exists.
    std::fs::create_dir_all(projects_dir()).ok();

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
        .fallback(serve_embedded)
        .layer(CorsLayer::permissive());

    let addr = format!("{}:{}", args.host, args.port);
    println!("LaTeX project server running at http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
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
            format!("Working folder not found: {}", q.dir),
        ));
    }
    let node = tree::build_tree(&base, 0)?;
    Ok(Json(node))
}

// ---------- /api/browse (folder selection dialog) ----------

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
            format!("Folder not found: {start}"),
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

// ---------- /api/watch (Server-Sent Events: filesystem watcher) ----------

#[derive(Deserialize)]
struct WatchQuery {
    dir: String,
}

/// Opens an SSE connection that sends a "change" event whenever something
/// changes on the filesystem inside `dir` (recursively). The frontend uses
/// this to update the folder tree automatically, without the user having
/// to reload manually.
async fn watch_dir_sse(
    Query(q): Query<WatchQuery>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let dir = PathBuf::from(&q.dir);
    if !dir.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Folder not found: {}", q.dir),
        ));
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<()>(4);

    // notify's watcher is not async; it therefore runs in its own
    // blocking thread and reports changes back through the channel.
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
    /// Directory in which the new folder is to be created.
    dir: String,
    name: String,
}

async fn create_folder(Json(body): Json<CreateFolderBody>) -> ApiResult<Json<serde_json::Value>> {
    let dir = PathBuf::from(&body.dir);
    if !dir.is_dir() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Target folder not found: {}", body.dir),
        ));
    }

    let raw_name = body.name.trim();
    if raw_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "Folder name must not be empty.".into()));
    }
    if raw_name.contains('/') || raw_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Folder name must not contain path separators.".into(),
        ));
    }

    let target = dir.join(raw_name);
    if target.exists() {
        return Err(AppError(
            StatusCode::CONFLICT,
            format!("Something with this name already exists: {}", target.display()),
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
    let path = PathBuf::from(&q.path);
    let content = std::fs::read_to_string(&path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("File could not be read ({}): {e}", path.display()),
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
    backup_before_change(&path); // .bak of the previous version before it is overwritten
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
            format!("Target folder not found: {}", body.dir),
        ));
    }

    let raw_name = body.name.trim();
    if raw_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "File name must not be empty.".into()));
    }
    if raw_name.contains('/') || raw_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "File name must not contain path separators.".into(),
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
            format!("File already exists: {}", target.display()),
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
            format!("File/folder not found: {}", body.path),
        ));
    }

    let new_name = body.new_name.trim();
    if new_name.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "New name must not be empty.".into()));
    }
    if new_name.contains('/') || new_name.contains('\\') {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Name must not contain path separators.".into(),
        ));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| AppError(StatusCode::BAD_REQUEST, "No parent folder found.".into()))?
        .to_path_buf();
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err(AppError(
            StatusCode::CONFLICT,
            format!("Something named {new_name} already exists"),
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
            format!("File/folder not found: {}", body.path),
        ));
    }

    if path.is_dir() {
        // A recursive .bak of a whole folder cannot be represented sensibly
        // (there is no single file name) — so no backup is made here.
        std::fs::remove_dir_all(&path)?;
    } else {
        backup_before_change(&path); // Content is kept as .bak in case it was deleted by accident
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
            format!("LaTeX file not found: {}", body.path),
        ));
    }

    let result = tokio::task::spawn_blocking(move || compile::run_compile(&tex_path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task error: {e}")))??;

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
    /// Path of the (comparison) file selected in the working folder.
    old_path: String,
    /// Path of the (new) file currently open in the editor.
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
            format!("Selected file not found: {}", body.old_path),
        ));
    }
    if !new_path.is_file() {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            format!("Editor file not found: {}", body.new_path),
        ));
    }
    if old_path == new_path {
        return Err(AppError(
            StatusCode::BAD_REQUEST,
            "Please select a different file in the working folder than the one open in the editor.".into(),
        ));
    }

    let result = tokio::task::spawn_blocking(move || latexdiff::run_latexdiff(&old_path, &new_path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task error: {e}")))?;

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
            format!("PDF not found ({}): {e}", path.display()),
        )
    })?;

    // "inline" explicitly tells the browser to display the PDF directly
    // instead of downloading it. Without this header the decision is left
    // to the browser's heuristics, which can be inconsistent depending on
    // settings, extensions or browser version.
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dokument.pdf");
    let disposition = format!("inline; filename=\"{}\"", file_name.replace('\"', "'"));

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
                "Unsupported image file.".into(),
            ))
        }
    };

    let bytes = std::fs::read(&path).map_err(|e| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Image not found ({}): {e}", path.display()),
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
            format!("Table file not found: {}", path.display()),
        ));
    }

    let result = tokio::task::spawn_blocking(move || table::read_table(&path))
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, format!("Task error: {e}")))
        .map_err(|e| AppError(StatusCode::BAD_REQUEST, e.0.to_string()))?;

    Ok(Json(result))
}

// ---------- /api/bib ----------

async fn get_bib(Query(q): Query<PathQuery>) -> ApiResult<Json<Vec<bibtex::BibEntry>>> {
    let content = std::fs::read_to_string(&q.path).map_err(|e| {
        AppError(
            StatusCode::BAD_REQUEST,
            format!("BibTeX file could not be read ({}): {e}", q.path),
        )
    })?;
    let entries = bibtex::parse_bib(&content);
    Ok(Json(entries))
}

// ---------- /api/bib/entry/create (create new entry) ----------

#[derive(Deserialize)]
struct BibEntryCreateBody {
    bib_path: String,
    /// Raw BibTeX source of the new entry, e.g. "@article{key, ...}".
    raw: String,
}

async fn create_bib_entry(Json(body): Json<BibEntryCreateBody>) -> ApiResult<Json<serde_json::Value>> {
    let raw = body.raw.trim();
    if raw.is_empty() {
        return Err(AppError(StatusCode::BAD_REQUEST, "The entry must not be empty.".into()));
    }

    let bib_path = PathBuf::from(&body.bib_path);

    // If the file does not exist yet, it is created here (empty initial
    // content); std::fs::write creates it automatically.
    let existing = std::fs::read_to_string(&bib_path).unwrap_or_default();

    let mut new_content = existing;
    if !new_content.is_empty() {
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push('\n'); // Blank line separating it from the previous entry
    }
    new_content.push_str(raw);
    new_content.push('\n');

    backup_before_change(&bib_path); // .bak of the file before the new entry is appended
    std::fs::write(&bib_path, new_content)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------- /api/bib/entry (edit entry) ----------

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
            format!("BibTeX file could not be read ({}): {e}", body.bib_path),
        )
    })?;

    let entries = bibtex::parse_bib(&content);
    let entry = entries.iter().find(|e| e.key == body.original_key).ok_or_else(|| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Entry '{}' was not found in the file.", body.original_key),
        )
    })?;

    // Use exact position tracking instead of find() to avoid ambiguity
    let start = entry.start;
    let end = entry.end;

    let mut new_content = String::with_capacity(content.len() - (end - start) + body.raw.len());
    new_content.push_str(&content[..start]);
    new_content.push_str(&body.raw);
    new_content.push_str(&content[end..]);

    backup_before_change(&PathBuf::from(&body.bib_path)); // .bak of the file before editing
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
            format!("BibTeX file could not be read ({}): {e}", body.bib_path),
        )
    })?;

    let entries = bibtex::parse_bib(&content);
    let entry = entries.iter().find(|e| e.key == body.key).ok_or_else(|| {
        AppError(
            StatusCode::NOT_FOUND,
            format!("Entry '{}' was not found in the file.", body.key),
        )
    })?;

    // Use exact position tracking instead of find() to avoid ambiguity
    let start = entry.start;
    let end = entry.end;

    let mut new_content = String::with_capacity(content.len());
    new_content.push_str(&content[..start]);
    new_content.push_str(&content[end..]);

    backup_before_change(&PathBuf::from(&body.bib_path)); // .bak of the file before the entry is deleted
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
