# LaTeX Project Server

A small Rust (Axum) web server that provides a single-page web interface
for editing and compiling LaTeX projects.

## Requirements

- Rust/Cargo (tested with Rust 1.75+)
- A LaTeX distribution installed in the server's `PATH` (e.g. TeX Live)
  with the `pdflatex` and `bibtex` programs, so the compile function
  works. Without a LaTeX installation the server still starts, but the
  compile button then reports a corresponding error.
- The table preview/insertion feature uses the Rust library `calamine`
  (downloaded automatically from crates.io when building) — no separate
  installation of Excel or LibreOffice is needed on the server to read
  `.xlsx`, `.xls`, `.ods` or `.csv` files.
- The diff feature (area 1) requires the `latexdiff` command-line tool in
  the server's `PATH` (part of most TeX Live installations; on
  Debian/Ubuntu it can be installed via `apt install latexdiff` or
  `texlive-extra-utils`). Without `latexdiff` the "Create diff" button
  reports a corresponding error message instead of crashing.
- Automatic filesystem watching uses the Rust library `notify`
  (downloaded automatically from crates.io when building, no separate
  installation needed). On Linux it uses inotify; OS-level limits such as
  `fs.inotify.max_user_watches` can become relevant for very large working
  folders, but are not a concern for typical LaTeX projects.

## Running

Start the server with Cargo:

```bash
cargo run --release
```

To pass command-line options, append them after `--` when using Cargo:

```bash
cargo run --release -- --host 0.0.0.0 --port 3000
```

You can also start the compiled binary directly:

```bash
./target/release/latex-project-server --host 0.0.0.0 --port 3000
```

The server then runs at <http://localhost:3000> by default (or at the
configured host/port combination, e.g. `http://127.0.0.1:3000` if you bind
it to the loopback interface).

Supported CLI options:

- `-p`, `--port <PORT>`: port number to listen on (default: `3000`)
- `-H`, `--host <HOST>`: address to bind to (default: `0.0.0.0`)
- `-h`, `--help`: show usage information
- `-V`, `--version`: show version information

The compiled binary (`target/release/latex-project-server`) can also be
started directly, from any directory. The whole frontend (`static/`,
including the vendored CodeMirror files) is embedded into the binary at
build time, so it does not depend on the current working directory.
Saved projects (`projects/`) are stored in a `projects/` folder next to
the binary. Note: after changing anything under `static/`, rebuild
(`cargo build --release`) for the change to take effect, since the files
are compiled in.

## Usage

1. **Open a working folder**: Either type the path directly into the text
   field and click "Open", or use "Browse…" to open the graphical folder
   selection dialog. This shows the server-side directory tree (click a
   subfolder to navigate into it, the up-arrow button to go up one level)
   — "Choose this folder" adopts the currently shown folder. The folder
   contents then appear on the left (area 1); an existing `.bib` file is
   automatically shown in the fourth area. The working folder itself is
   always expanded, all **subfolders start collapsed** (arrow "▶") — a
   click on a subfolder expands it ("▼") or collapses it again; the state
   is preserved even after creating/renaming/deleting files (until a new
   working folder is opened). Every file shows a colored SVG icon matching
   its file type (blue for `.tex`, purple for `.bib`, red for PDF, green
   for images, orange for tables, gray for class/style/log/build files,
   yellow for `.bak` backups); folders switch between a closed and an open
   icon. All icons throughout the app are implemented as embedded SVGs —
   deliberately **no emoji** — so they are visible regardless of whether a
   color emoji font is installed on the system in use (see "Note on a
   fixed bug" below).
2. **Live synchronization with the filesystem**: The working folder is
   watched recursively for changes in the background (inotify on Linux).
   If something changes there — including outside the app, e.g. through
   another editor, `git pull`, or a script — the folder tree updates
   automatically, with no manual reload click needed.
3. **Edit a file**: A **double-click** on a `.tex` or `.txt` file in the
   folder tree opens it in the [CodeMirror](https://codemirror.net/5/)
   editor (area 2) with LaTeX syntax highlighting, line numbers, and
   automatic bracket matching. A single click only marks a file visually
   (and additionally remembers that file as the "selected file" for the
   diff feature, see below). Changes are saved via "Save" in the editor
   header, with `Ctrl+S`, or automatically **every 5 minutes** (if there
   are unsaved changes).
4. **Search & Replace / Undo / Redo**: At the bottom of the editor (same
   height as the editor header) there is a bar with a search field, "◀"/
   "▶" for the previous/next match (also via `Enter`/`Shift+Enter` in the
   search field), a match count, a replacement field, and "Replace"
   (current match) and "All" (all matches). While typing, **all** matches
   are highlighted in yellow in the editor (not just the currently active
   one, which is additionally set apart via the normal cursor selection);
   the highlighting is updated automatically after every replacement. On
   the far right are "↶" (undo) and "↷" (redo).
5. **LaTeX autocompletion**: While typing a `\` in the editor, a
   suggestion menu with matching LaTeX commands automatically appears
   (e.g. `\section`, `\textbf`, `\includegraphics`, Greek letters, …);
   after `\begin{`/`\end{` matching environment names are suggested
   instead (e.g. `itemize`, `figure`, `tabular`). Select with the arrow
   keys and confirm with `Enter`/`Tab`, `Esc` closes the menu. It can also
   be invoked manually at any time with `Ctrl+Space`.
6. **Compile**: The "Compile" button in the editor header (area 2, next
   to "Save") saves the current file and invokes `pdflatex` with the
   `-file-line-error` flag (and `bibtex` if needed), so error messages
   include a precise line number. The result appears on the right
   (area 3) in the "PDF" tab; errors and warnings from the log end up in
   the "Errors" tab and are additionally **marked directly in the
   editor**: the affected line gets a red (error) or yellow (warning)
   background plus a matching icon in the gutter; clicking an entry in
   the error list jumps to the corresponding line in the editor. The page
   shown in the PDF viewer before compiling is remembered, and the new
   PDF preview automatically jumps back to that page afterward (via a
   `#page=N` fragment — a PDF parameter supported by all common
   browsers). *Remembering* the current page is best effort: whether the
   embedded browser PDF viewer exposes its current page via the iframe
   URL depends on the browser; if that fails, it falls back to the last
   known page or page 1 — this never causes an error, at most a less
   precise jump target.
7. **Images**: A **double-click** on an image file (PNG, JPG, GIF, SVG,
   BMP, WebP, …) in the working folder opens a preview dialog. **Dragging**
   an image file into the editor inserts a ready-made `figure` skeleton at
   the drop position (`\includegraphics` with an automatically computed
   relative path to the currently open `.tex` file, `\caption`, `\label`).
8. **Tables (Excel/LibreOffice/CSV)**: A **double-click** on an `.xlsx`,
   `.xls`, `.ods`, or `.csv` file shows its first worksheet as a scrollable
   preview (CSV with automatic detection of comma or semicolon as the
   delimiter). **Dragging** into the editor inserts a `table` skeleton with
   the actual cell data (LaTeX special characters are escaped
   automatically; for more than 20 rows, only the first 20 are included,
   with a comment noting the total row count — for complete data, please
   check via the preview and extend the table by hand in the editor if
   needed). The generated table uses `booktabs` commands;
   `\usepackage{booktabs}` must be added to the preamble (a corresponding
   comment is inserted along with it).
9. **PDF files**: A **double-click** on a `.pdf` file in the working
   folder opens it in a new browser tab.
10. **Manage files and folders**: Right-clicking a file, a folder, or an
    empty area in the working folder opens a context menu with "New
    folder here", "New .tex file here", "Rename", and "Delete" (for
    folders, including their contents — a confirmation prompt follows).
    New `.tex` files get a minimal LaTeX skeleton as their content; a
    newly created folder is shown expanded right away. The working folder
    itself can neither be renamed nor deleted. All of these actions act
    directly on the filesystem and become visible in the tree immediately
    thanks to live synchronization (see point 2). (There are deliberately
    no separate "New folder"/"New file" buttons in the header of area 1
    anymore — that would have been duplicate functionality relative to
    the context menu.)
11. **Create diff (latexdiff)**: At the bottom of area 1 (same height as
    the header) sits the "Create diff" button. It compares the file
    selected in the working folder via **single click** (the "old"
    version) with the file currently **open in the editor** (the "new"
    version) using the `latexdiff` command-line tool. The editor content
    is automatically saved beforehand for this. The result is a new file
    `diff-<old>-vs-<new>.tex` in the same folder as the editor file, with
    `\DIFadd{…}`/`\DIFdel{…}` markup (including the preamble packages
    automatically added by `latexdiff`) — it is opened automatically in
    the editor after creation. If the selected and open files are
    identical, or either selection is missing, a corresponding status
    message appears instead of an error.
12. **Sources**: The fourth area shows the BibTeX entries found in the
    working folder (key, type, title, author, year).
    - **Double-click** on an entry opens its source in a new window/tab:
      an existing `url`, `link`, or `doi` field, otherwise a Google
      Scholar search for title and author as a fallback.
    - **Dragging** an entry into the editor (area 2) inserts
      `\cite{key}` exactly at the position where it is dropped.
    - **Right-click** opens a context menu with "Open link/Google
      Scholar", "Insert \cite{} at cursor" (alternative to dragging),
      "Edit" (raw BibTeX source editable in a dialog), and "Delete"
      (with a confirmation prompt).
    - The "+ New" button at the top of area 4 opens the same edit dialog
      with a pre-filled `@article` skeleton for creating a new entry. If
      no `.bib` file is open yet, you are first asked for a file name
      (suggestion: `references.bib`) and the file is created in the
      working folder if needed.
13. **Save/load project**: Enter a project name at the top and click
    "Save" to store the project name, working folder, and the last
    opened `.tex`/`.bib` file on the server under `projects/<name>.json`.
    The dropdown and "Load" restore that state later.

## Automatic backups (.bak)

Before every content change to an existing file, a backup copy is
automatically created under the same name with `.bak` appended (e.g.
`chapter1.tex` → `chapter1.tex.bak`). A new `.bak` file overwrites the
previous one each time — so the state *immediately before* the last
change is always kept, not the full history. This applies to:

- Saving a `.tex`/`.txt` file in the editor (including during the
  automatic save every 5 minutes)
- Deleting a file via the context menu (the deleted file is thus
  preserved as a `.bak`)
- Creating, editing, and deleting individual BibTeX entries (the entire
  `.bib` file is backed up before the change each time)

No backup is created when renaming (the content doesn't change), when
creating a brand-new file (there's nothing to back up yet), or when
deleting an entire folder (a single `.bak` cannot represent a folder's
contents).

## Project structure

```text
src/
  main.rs      – HTTP routes and server setup: directory tree, folder
                 selection (/api/browse), create folder
                 (/api/folder/create), read/save/create/rename/delete
                 file, filesystem watching as Server-Sent Events
                 (/api/watch), image preview (/api/image), table preview
                 (/api/table), compiling (/api/compile), diff creation
                 (/api/latexdiff), reading BibTeX as well as creating/
                 editing/deleting individual entries
                 (/api/bib/entry/create, /api/bib/entry,
                 /api/bib/entry/delete)
  tree.rs      – Recursive directory tree for the working folder
  watch.rs     – Recursively watches a folder for filesystem changes
                 (via the `notify` library, inotify on Linux) and reports
                 them back debounced (300 ms) through a channel; shuts
                 down cleanly as soon as the SSE client disconnects
  bibtex.rs    – Simple, brace-tolerant BibTeX parser
  table.rs     – Reads .xlsx/.xls/.xlsb/.ods via the `calamine` library,
                 and .csv via its own quote-aware parser (with comma/
                 semicolon detection) into a unified header/row structure
  compile.rs   – pdflatex/bibtex pipeline (with -file-line-error)
                 including log parsing into structured errors/warnings
                 with line numbers
  latexdiff.rs – Invokes the external `latexdiff` command-line tool and
                 writes its output as a new .tex file
                 (`diff-<old>-vs-<new>.tex`) next to the editor file
  project.rs   – Save/load project configurations (JSON files)
  static/
  index.html   – Page structure (toolbar + 4 areas with headers and, in
                 some cases, footers + dialogs + context menus)
  style.css    – Layout (10% / 40% / 40% / 10%) and styling; the headers
                 and footers of all areas use the same CSS variable
                 (--area-header-height) for a consistent height
  app.js       – Frontend logic (fetch calls, tree with type-matching
                 icons and expand/collapse, synchronized live with the
                 filesystem via Server-Sent Events, CodeMirror, tabs,
                 folder selection dialog, context menus, image/table
                 preview, drag-and-drop insertion of \figure/\table/\cite,
                 automatic saving every 5 minutes, search/replace with
                 match highlighting, LaTeX autocompletion, diff creation)
  vendor/codemirror/ – Locally embedded CodeMirror 5 files (JS/CSS,
                 including LaTeX mode, the Eclipse theme, the
                 search-cursor addon for the search/replace bar, and the
                 hint addon for LaTeX autocompletion). Deliberately NOT
                 loaded via CDN, so the editor loads reliably regardless
                 of external network reachability (firewalls, ad
                 blockers, offline use).
  projects/      – Stored project configurations (created automatically next to the binary at runtime)
```

## Known limitations

- The folder path is entered as text (no native browser file dialog),
  since the server needs direct access to the local filesystem.
- The BibTeX parser covers the common cases (nested braces, quotation
  marks, bare numeric values), but not `@string` macros.
- When dragging a table file into the editor, its content is loaded via a
  brief synchronous request to the server (technically necessary so the
  data is still available within the same drag operation by the time it's
  needed); for very large files this can cause a brief stutter while
  dragging. A plain preview without this delay only needs a double-click.
- The server is not designed for multi-user operation — it serves as a
  local tool for a single LaTeX project at a time.
- `.bak` backups are stored in the same folder as the original file and
  therefore also appear in the folder tree (area 1). This is intentional
  (transparency), but can be visually noticeable with a lot of changes.

## Note on a fixed bug (PDF preview)

Earlier versions loaded CodeMirror via a CDN (`cdnjs.cloudflare.com`). If
that CDN was unreachable (firewall, ad blocker, offline use), editor
initialization failed *before* the app had remembered the open file
path — with the result that "Compile" apparently failed for no reason
with "Please select a .tex file first" and no PDF was ever produced.
CodeMirror is now bundled locally (`static/vendor/`) and therefore loads
with no external network dependency at all; in addition, the app now
remembers the open file path regardless of whether the editor display
itself could be built successfully.

In addition, `/api/pdf` (and `/api/image`) previously sent no
`Content-Disposition` header. Without this header, some browsers leave
the "display inline vs. download" decision to a heuristic that, depending
on browser version, settings, or installed extensions, can result in a
download instead of display — the PDF tab then stayed empty and a
download dialog opened instead. Both endpoints now explicitly send
`Content-Disposition: inline`, which tells browsers unambiguously to
display the content directly.

## Note on a fixed bug (invisible icons)

Earlier versions used Unicode emoji characters for all icons (file tree,
buttons, context menus, status messages). Their display depends on
whether a color emoji font is installed on the given system (e.g. "Noto
Color Emoji" on Linux, bundled by default on Windows/macOS) — on many
Linux server or minimal installations such a font is missing, which made
all icons invisible even though the rest of the text displayed normally.
All icons are now implemented as an embedded SVG sprite (`<symbol>`
definitions at the top of `index.html`, referenced via `<use>`) and use
`currentColor`/CSS classes for coloring instead of emoji characters. This
makes them display identically on every system regardless of installed
fonts. As a side effect, the "New folder"/"New .tex file" buttons in the
header of area 1 were also removed, since the same functionality was
already available via the right-click context menu (see point 10 above).

## Note on a fixed bug (binary only worked via `cargo run`)

Earlier versions served the frontend with `ServeDir::new("static")` and
stored projects in `projects/`. Both are relative paths, resolved against
the process's *current working directory* — not against the binary's
location and not against any environment variable. `cargo run` is
normally invoked from the project root, so it worked; starting the
compiled binary from another directory (e.g. from inside
`target/release/`) made the server start normally but answer every page
request with HTTP 404. The frontend is now embedded into the binary
(`include_dir`) and `projects/` is resolved relative to the executable.
