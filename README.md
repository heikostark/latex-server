# LaTeX Project Server

A small web server written in Rust (using Axum) that provides a single-page web UI for editing and compiling LaTeX projects.

## Prerequisites

- Rust and Cargo (tested with Rust 1.75+).
- A LaTeX installation available in the server's PATH (e.g. TeX Live) with the programs `pdflatex` and `bibtex` so the compile feature works. The server will still start without a LaTeX installation, but the compile button will report an error.
- The Rust crate `calamine` is used for spreadsheet preview/insertion (it is fetched automatically from crates.io during build) — no separate Excel or LibreOffice installation is required to read `.xlsx`, `.xls`, `.ods` or `.csv` files.
- The command-line tool `latexdiff` is required in the server's PATH for the diff feature (it is part of most TeX Live installations and can be installed on Debian/Ubuntu via `apt install latexdiff` or `texlive-extra-utils`). Without `latexdiff` the "Create diff" button displays a helpful error message instead of crashing.
- The Rust crate `notify` is used for automatic filesystem watching (fetched from crates.io during build, no separate installation required). On Linux it uses inotify; OS-level limits such as `fs.inotify.max_user_watches` can become relevant for very large work folders but are not an issue for typical LaTeX projects.

## Starting

Run the server in release mode:

```bash
cargo run --release
```

After that the server is available at http://localhost:3000 — open that address in your browser.

## Usage

1. Open a workspace: either enter the path directly in the text field and click "Open", or use "Browse…" to open a server-side folder picker. The folder picker shows the server-side directory tree (click subfolders to navigate, use the "up" arrow to go one level up). Click "Select this folder" to choose the currently displayed directory. The folder contents then appear on the left (Area 1); a found `.bib` file is automatically shown in Area 4. The workspace root is always expanded; all subfolders start closed (▶). Click a subfolder to toggle it open (▼). The open/closed state is preserved across create/rename/delete operations until a different workspace is opened. Each file shows a colored SVG icon matching the file type (blue for `.tex`, purple for `.bib`, red for PDF, green for images, orange for spreadsheets, gray for class/style/log/build files, yellow for `.bak` backups). All icons are embedded SVGs (not emoji) so they display correctly even if no color-emoji font is installed on the host system.

2. Live synchronization with the filesystem: the workspace is watched recursively in the background (inotify on Linux). If files change outside the app (another editor, `git pull`, a script), the tree updates automatically — no manual reload required.

3. Edit files: double-click a `.tex` or `.txt` file in the tree to open it in the CodeMirror editor (Area 2) with LaTeX highlighting, line numbers and automatic bracket checking. Single-click only visually selects a file and remembers it as the "selected file" for the diff feature. Changes are saved via the "Save" button in the editor header, with Ctrl+S, or automatically every 5 minutes if there are unsaved changes.

4. Find & Replace / Undo / Redo: at the bottom of the editor (aligned with the editor header) there is a bar with a search field, "◀"/"▶" for previous/next match (also via Enter / Shift+Enter), match count, a replace field and buttons for "Replace" (current match) and "All" (all matches). All matches are highlighted in yellow while typing (not only the active match, which additionally uses the normal cursor selection). After each replacement the highlights update automatically. On the right there are undo (↶) and redo (↷) buttons.

5. LaTeX completion: the editor shows an auto-completion menu when typing after a `\` with suggested LaTeX commands (e.g. `\section`, `\textbf`, `\includegraphics`, Greek letters, …). After `\begin{` / `\end{` it suggests environment names (e.g. `itemize`, `figure`, `tabular`). Use the arrow keys and confirm with Enter/Tab; Esc closes the menu. Manual completion can be triggered with Ctrl+Space.

6. Compile: the "Compile" button in the editor header (Area 2, next to "Save") saves the current file and runs `pdflatex` with `-file-line-error` (and `bibtex` if necessary) so log messages contain precise line numbers. The PDF output appears on the right (Area 3) under the "PDF" tab; errors and warnings appear under the "Errors" tab and are additionally marked directly in the editor: the affected line receives a red (error) or yellow (warning) background and an icon in the gutter; clicking an entry in the error list jumps to the corresponding line in the editor. The page shown in the PDF viewer before compilation is remembered and the new preview automatically returns to that page via a `#page=N` fragment (supported by mainstream browsers). Remembering the current page is best-effort: whether an embedded browser PDF viewer exposes its page via the iframe URL depends on the browser; if it cannot be determined the viewer falls back to the last known page or page 1 without raising an error.

7. Images: double-clicking an image file (PNG, JPG, GIF, SVG, BMP, WebP, …) opens a preview dialog. Dragging an image into the editor inserts a ready-made `figure` skeleton at the drop location (`\includegraphics` with an automatically computed relative path to the currently open `.tex` file, plus `\caption` and `\label`).

8. Spreadsheets (Excel / LibreOffice / CSV): double-clicking a `.xlsx`, `.xls`, `.ods` or `.csv` file shows its first sheet as a scrollable preview (CSV separators [comma/semicolon] are detected automatically). Dragging a spreadsheet into the editor inserts a `table` skeleton with the actual cell data (LaTeX special characters are escaped automatically). If the sheet has more than 20 rows only the first 20 are inserted and a comment notes the total row count — for full data please check the preview and extend the table manually if necessary. The generated table uses `booktabs` commands; add `\usepackage{booktabs}` to your preamble (a reminder comment is inserted when a table is generated).

9. PDF files: double-clicking a `.pdf` file opens it in a new browser tab.

10. Manage files and folders: right-click a file, folder or empty area in the workspace to open a context menu with "New folder here", "New .tex file here", "Rename" and "Delete" (deleting a folder also removes its contents after a safety prompt). New `.tex` files receive a minimal LaTeX skeleton. A newly created folder is expanded immediately. The workspace root cannot be renamed or deleted. All actions take effect on the filesystem immediately and are visible in the tree thanks to live synchronization. (There are no separate "New folder" / "New file" buttons in Area 1 to avoid duplicating the context-menu functionality.)

11. Create a diff (latexdiff): the "Create diff" button at the bottom of Area 1 compares the single-click-selected file in the tree (the "old" version) with the file currently open in the editor (the "new" version) using the `latexdiff` command-line tool. The editor content is saved automatically before running. The output is written to a new file named `diff-<old>-vs-<new>.tex` in the same folder as the editor file and contains `\DIFadd{…}` / `\DIFdel{…}` markup (including any preamble packages `latexdiff` adds). The diff file is opened automatically in the editor after creation. If the selected and open files are identical or one of them is missing, an informative status message is shown instead of an error.

12. Bibliography (Area 4): the fourth area shows BibTeX entries found in the workspace (key, type, title, author, year).
    - Double-clicking an entry opens its source in a new window/tab: the `url`, `link` or `doi` field if present, otherwise a Google Scholar search for title and author.
    - Dragging an entry into the editor inserts `\cite{key}` at the drop position.
    - Right-clicking opens a context menu with "Open link / Google Scholar", "Insert \cite{} at cursor" (alternative to drag), "Edit" (raw BibTeX in a dialog) and "Delete" (with confirmation).
    - The "+ New" button at the top of Area 4 opens the same edit dialog pre-filled with an `@article` skeleton for creating a new entry. If no `.bib` file is currently open you are asked for a filename (suggested: `references.bib`) and the file is created in the workspace if needed.

13. Save / load project: enter a project name at the top and click "Save" to persist the project name, workspace path and the last opened `.tex` / `.bib` file server-side under `projects/<name>.json`. Use the dropdown and "Load" to restore that state later.

## Automatic backups (.bak)

Whenever the contents of an existing file change a backup copy with the same name plus a `.bak` suffix is created (e.g. `chapter1.tex` → `chapter1.tex.bak`). Each new `.bak` overwrites the previous one — only the version immediately before the last change is kept, not a full history. Backups are created for:

- Saving a `.tex` / `.txt` file in the editor (including automatic saves every 5 minutes).
- Deleting a file via the context menu (the deleted file remains available as `.bak`).
- Creating, editing or deleting individual BibTeX entries (the entire `.bib` file is backed up before the change).

No backup is created for renames (content is unchanged), creating a brand new file (there is nothing to back up yet), or deleting a whole folder (a single `.bak` cannot represent a folder's entire contents).

## Project structure

```
src/
  main.rs      – HTTP routes and server setup: directory tree, folder picker (/api/browse), create folder (/api/folder/create), read/save/create/rename/delete files, filesystem watch via Server-Sent Events (/api/watch), image preview (/api/image), table preview (/api/table), compile (/api/compile), diff creation (/api/latexdiff), BibTeX reading and individual entry create/edit/delete (/api/bib/entry/create, /api/bib/entry, /api/bib/entry/delete)
  tree.rs      – Recursive directory tree for the workspace
  watch.rs     – Recursively watches a folder for filesystem changes using `notify` (inotify on Linux) and debounces events (300 ms); stops cleanly when the SSE client disconnects
  bibtex.rs    – Lightweight, brace-tolerant BibTeX parser
  table.rs     – Reads .xlsx/.xls/.xlsb/.ods via the `calamine` crate and .csv via a custom parser (handles quoted fields, comma/semicolon detection) into a uniform header/row structure
  compile.rs   – pdflatex / bibtex pipeline (with -file-line-error) including log parsing that extracts structured errors/warnings with line numbers
  latexdiff.rs – Calls the external `latexdiff` tool and writes its output as a new .tex file (`diff-<old>-vs-<new>.tex`) next to the editor file
  project.rs   – Save / load project configurations (JSON files)
static/
  index.html   – Page layout (button bar + 4 areas with headers and optional footers + dialogs + context menus)
  style.css    – Layout (10% / 40% / 40% / 10%) and styling; area headers/footers share a CSS variable (--area-header-height) for consistent heights
  app.js       – Frontend logic (fetch calls, type-appropriate icons and open/close state for the tree, live filesystem sync via Server-Sent Events, CodeMirror, tabs, folder picker dialog, context menus, image/table preview, drag & drop insertion of \figure / \table / \cite, auto-save every 5 minutes, find/replace with highlight, LaTeX completion, diff creation)
  vendor/codemirror/ – Locally embedded CodeMirror 5 assets (JS/CSS, including LaTeX mode, Eclipse theme, the SearchCursor addon for the find/replace bar and the Hint addon for LaTeX completion). Intentionally not loaded via CDN so the editor works without external network access (firewalls, ad blockers, offline usage).
projects/      – Saved project configurations (created automatically)
```

## Known limitations

- The workspace path is entered as text (not a native browser file picker) because the server needs direct access to the local filesystem.
- The BibTeX parser covers common cases (nested braces, quotes, bare numeric values) but does not implement `@string` macros.
- Dragging a spreadsheet into the editor loads its content via a short synchronous request to the server (necessary so the data is available during the drag operation); very large files may cause a short pause during the drag. For a pure preview without that delay use double-click.
- The server is not designed for multi-user usage — it is intended as a local tool for a single LaTeX project at a time.
- `.bak` backups are stored in the same folder as the original file and therefore appear in the file tree (Area 1). This is deliberate (transparency) but can be visually noisy after many changes.

## Note about a fixed bug (PDF preview)

Earlier versions loaded CodeMirror from a CDN (`cdnjs.cloudflare.com`). If that CDN was blocked (firewall, ad blocker, offline usage) the editor initialization failed before the app remembered the opened workspace path — which could cause "Compile" to fail with "Please select a .tex file first" even though a file had been selected. CodeMirror is now bundled locally (`static/vendor/`) and no external network dependency is required; the app also remembers the opened file path independently of whether the editor UI initialized successfully.

In addition `/api/pdf` (and `/api/image`) previously did not send a `Content-Disposition` header. Without this header some browsers apply heuristics that may trigger a download dialog instead of inline display; the PDF tab could then appear empty while a download dialog opened. Both endpoints now explicitly return `Content-Disposition: inline`, which tells browsers to display the content directly.

## Note about a fixed bug (invisible icons)

Earlier versions used Unicode emoji for all icons (file tree, buttons, context menus, status messages). Whether emoji are visible depends on whether a color-emoji font is installed on the system (e.g. "Noto Color Emoji" on Linux; included by default on Windows/macOS) — many minimal Linux/server installations lack such a font and icons were therefore invisible even though text displayed normally. All icons are now implemented as an embedded SVG sprite (`<symbol>` definitions at the top of `index.html`, referenced via `<use>`) and are colored via `currentColor` / CSS classes rather than emoji. This makes them reliably visible across systems. As a side effect the "New folder" / "New .tex file" buttons in Area 1 header were removed because their functionality is available in the right-click context menu (see point 10 above).
