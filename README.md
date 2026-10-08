1| # LaTeX Project Server
2| 
3| A small Rust (Axum) web server that provides a single-page web interface
4| for editing and compiling LaTeX projects.
5| 
6| ## Requirements
7| 
8| - Rust/Cargo (tested with Rust 1.75+)
9| - A LaTeX distribution installed in the server's `PATH` (e.g. TeX Live)
10|   with the `pdflatex` and `bibtex` programs, so the compile function
11|   works. Without a LaTeX installation the server still starts, but the
12|   compile button then reports a corresponding error.
13| - The table preview/insertion feature uses the Rust library `calamine`
14|   (downloaded automatically from crates.io when building) — no separate
15|   installation of Excel or LibreOffice is needed on the server to read
16|   `.xlsx`, `.xls`, `.ods` or `.csv` files.
17| - The diff feature (area 1) requires the `latexdiff` command-line tool in
18|   the server's `PATH` (part of most TeX Live installations; on
19|   Debian/Ubuntu it can be installed via `apt install latexdiff` or
20|   `texlive-extra-utils`). Without `latexdiff` the "Create diff" button
21|   reports a corresponding error message instead of crashing.
22| - Automatic filesystem watching uses the Rust library `notify`
23|   (downloaded automatically from crates.io when building, no separate
24|   installation needed). On Linux it uses inotify; OS-level limits such as
25|   `fs.inotify.max_user_watches` can become relevant for very large working
26|   folders, but are not a concern for typical LaTeX projects.
27| 
28| ## Running
29| 
30| Start the server with Cargo:
31| 
32| ```bash
33| cargo run --release
34| ```
| 
35| To pass command-line options, append them after `--` when using Cargo:
36| 
37| ```bash
38| cargo run --release -- --host 0.0.0.0 --port 3000
39| ```
| 
40| You can also start the compiled binary directly:
41| 
42| ```bash
43| ./target/release/latex-project-server --host 0.0.0.0 --port 3000
44| ```
| 
45| The server then runs at <http://localhost:3000> by default (or at the
46| configured host/port combination, e.g. `http://127.0.0.1:3000` if you bind
47| it to the loopback interface).
48| 
49| Supported CLI options:
50| 
51| - `-p`, `--port <PORT>`: port number to listen on (default: `3000`)
52| - `-H`, `--host <HOST>`: address to bind to (default: `0.0.0.0`)
53| - `-h`, `--help`: show usage information
54| - `-V`, `--version`: show version information
55| 
56| The compiled binary (`target/release/latex-project-server`) can also be
57| started directly, from any directory. The whole frontend (`static/`,
58| including the vendored CodeMirror files) is embedded into the binary at
59| build time, so it does not depend on the current working directory.
60| Saved projects (`projects/`) are stored in a `projects/` folder next to
61| the binary. Note: after changing anything under `static/`, rebuild
62| (`cargo build --release`) for the change to take effect, since the files
63| are compiled in.
64| 
65| ## Usage
66| 
67| 1. **Open a working folder**: Either type the path directly into the text
68|    field and click "Open", or use "Browse…" to open the graphical folder
69|    selection dialog. This shows the server-side directory tree (click a
70|    subfolder to navigate into it, the up-arrow button to go up one level)
71|    — "Choose this folder" adopts the currently shown folder. The folder
72|    contents then appear on the left (area 1); an existing `.bib` file is
73|    automatically shown in the fourth area. The working folder itself is
74|    always expanded, all **subfolders start collapsed** (arrow "▶") — a
75|    click on a subfolder expands it ("▼") or collapses it again; the state
76|    is preserved even after creating/renaming/deleting files (until a new
77|    working folder is opened). Every file shows a colored SVG icon matching
78|    its file type (blue for `.tex`, purple for `.bib`, red for PDF, green
79|    for images, orange for tables, gray for class/style/log/build files,
80|    yellow for `.bak` backups); folders switch between a closed and an open
81|    icon. All icons throughout the app are implemented as embedded SVGs —
82|    deliberately **no emoji** — so they are visible regardless of whether a
83|    color emoji font is installed on the system in use (see "Note on a
84|    fixed bug" below).
85| 2. **Live synchronization with the filesystem**: The working folder is
86|    watched recursively for changes in the background (inotify on Linux).
87|    If something changes there — including outside the app, e.g. through
88|    another editor, `git pull`, or a script — the folder tree updates
89|    automatically, with no manual reload click needed.
90| 3. **Edit a file**: A **double-click** on a `.tex` or `.txt` file in the
91|    folder tree opens it in the [CodeMirror](https://codemirror.net/5/)
92|    editor (area 2) with LaTeX syntax highlighting, line numbers, and
93|    automatic bracket matching. A single click only marks a file visually
94|    (and additionally remembers that file as the "selected file" for the
95|    diff feature, see below). Changes are saved via "Save" in the editor
96|    header, with `Ctrl+S`, or automatically **every 5 minutes** (if there
97|    are unsaved changes).
98| 4. **Search & Replace / Undo / Redo**: At the bottom of the editor (same
99|    height as the editor header) there is a bar with a search field, "◀"/
100|    "▶" for the previous/next match (also via `Enter`/`Shift+Enter` in the
101|    search field), a match count, a replacement field, and "Replace"
102|    (current match) and "All" (all matches). While typing, **all** matches
103|    are highlighted in yellow in the editor (not just the currently active
104|    one, which is additionally set apart via the normal cursor selection);
105|    the highlighting is updated automatically after every replacement. On
106|    the far right are "↶" (undo) and "↷" (redo).
107| 5. **LaTeX autocompletion**: While typing a `\` in the editor, a
108|    suggestion menu with matching LaTeX commands automatically appears
109|    (e.g. `\section`, `\textbf`, `\includegraphics`, Greek letters, …);
110|    after `\begin{`/`\end{` matching environment names are suggested
111|    instead (e.g. `itemize`, `figure`, `tabular`). Select with the arrow
112|    keys and confirm with `Enter`/`Tab`, `Esc` closes the menu. It can also
113|    be invoked manually at any time with `Ctrl+Space`.
114| 6. **Compile**: The "Compile" button in the editor header (area 2, next
115|    to "Save") saves the current file and invokes `pdflatex` with the
116|    `-file-line-error` flag (and `bibtex` if needed), so error messages
117|    include a precise line number. The result appears on the right
118|    (area 3) in the "PDF" tab; errors and warnings from the log end up in
119|    the "Errors" tab and are additionally **marked directly in the
120|    editor**: the affected line gets a red (error) or yellow (warning)
121|    background plus a matching icon in the gutter; clicking an entry in
122|    the error list jumps to the corresponding line in the editor. The page
123|    shown in the PDF viewer before compiling is remembered, and the new
124|    PDF preview automatically jumps back to that page afterward (via a
125|    `#page=N` fragment — a PDF parameter supported by all common
126|    browsers). *Remembering* the current page is best effort: whether the
127|    embedded browser PDF viewer exposes its current page via the iframe
128|    URL depends on the browser; if that fails, it falls back to the last
129|    known page or page 1 — this never causes an error, at most a less
130|    precise jump target.
131| 7. **Images**: A **double-click** on an image file (PNG, JPG, GIF, SVG,
132|    BMP, WebP, …) in the working folder opens a preview dialog. **Dragging**
|    an image file into the editor inserts a ready-made `figure` skeleton at
133|    the drop position (`\includegraphics` with an automatically computed
134|    relative path to the currently open `.tex` file, `\caption`, `\label`).
135| 8. **Tables (Excel/LibreOffice/CSV)**: A **double-click** on an `.xlsx`,
136|    `.xls`, `.ods`, or `.csv` file shows its first worksheet as a scrollable
137|    preview (CSV with automatic detection of comma or semicolon as the
138|    delimiter). **Dragging** into the editor inserts a `table` skeleton with
139|    the actual cell data (LaTeX special characters are escaped
140|    automatically; for more than 20 rows, only the first 20 are included,
141|    with a comment noting the total row count — for complete data, please
142|    check via the preview and extend the table by hand in the editor if
143|    needed). The generated table uses `booktabs` commands;
144|    `\usepackage{booktabs}` must be added to the preamble (a corresponding
145|    comment is inserted along with it).
146| 9. **PDF files**: A **double-click** on a `.pdf` file in the working
147|    folder opens it in a new browser tab.
148| 10. **Manage files and folders**: Right-clicking a file, a folder, or an
149|     empty area in the working folder opens a context menu with "New
150|     folder here", "New .tex file here", "Rename", and "Delete" (for
151|     folders, including their contents — a confirmation prompt follows).
152|     New `.tex` files get a minimal LaTeX skeleton as their content; a
153|     newly created folder is shown expanded right away. The working folder
154|     itself can neither be renamed nor deleted. All of these actions act
155|     directly on the filesystem and become visible in the tree immediately
156|     thanks to live synchronization (see point 2). (There are deliberately
157|     no separate "New folder"/"New file" buttons in the header of area 1
158|     anymore — that would have been duplicate functionality relative to
159|     the context menu.)
160| 11. **Create diff (latexdiff)**: At the bottom of area 1 (same height as
161|     the header) sits the "Create diff" button. It compares the file
162|     selected in the working folder via **single click** (the "old"
163|     version) with the file currently **open in the editor** (the "new"
|     version) using the `latexdiff` command-line tool. The editor content
164|     is automatically saved beforehand for this. The result is a new file
165|     `diff-<old>-vs-<new>.tex` in the same folder as the editor file, with
166|     `\DIFadd{…}`/`\DIFdel{…}` markup (including the preamble packages
167|     automatically added by `latexdiff`) — it is opened automatically in
168|     the editor after creation. If the selected and open files are
169|     identical, or either selection is missing, a corresponding status
170|     message appears instead of an error.
171| 12. **Sources**: The fourth area shows the BibTeX entries found in the
172|     working folder (key, type, title, author, year).
173|     - **Double-click** on an entry opens its source in a new window/tab:
174|       an existing `url`, `link`, or `doi` field, otherwise a Google
175|       Scholar search for title and author as a fallback.
176|     - **Dragging** an entry into the editor (area 2) inserts
177|       `\cite{key}` exactly at the position where it is dropped.
178|     - **Right-click** opens a context menu with "Open link/Google
179|       Scholar", "Insert \cite{} at cursor" (alternative to dragging),
180|       "Edit" (raw BibTeX source editable in a dialog), and "Delete"
181|       (with a confirmation prompt).
182|     - The "+ New" button at the top of area 4 opens the same edit dialog
183|       with a pre-filled `@article` skeleton for creating a new entry. If
184|       no `.bib` file is open yet, you are first asked for a file name
185|       (suggestion: `references.bib`) and the file is created in the
186|       working folder if needed.
187| 13. **Save/load project**: Enter a project name at the top and click
188|     "Save" to store the project name, working folder, and the last
189|     opened `.tex`/`.bib` file on the server under `projects/<name>.json`.
190|     The dropdown and "Load" restore that state later.
191| 
192| ## Automatic backups (.bak)
193| 
194| Before every content change to an existing file, a backup copy is
195| automatically created under the same name with `.bak` appended (e.g.
196| `chapter1.tex` → `chapter1.tex.bak`). A new `.bak` file overwrites the
197| previous one each time — so the state *immediately before* the last
198| change is always kept, not the full history. This applies to:
199| 
200| - Saving a `.tex`/`.txt` file in the editor (including during the
201|   automatic save every 5 minutes)
202| - Deleting a file via the context menu (the deleted file is thus
203|   preserved as a `.bak`)
204| - Creating, editing, and deleting individual BibTeX entries (the entire
205|   `.bib` file is backed up before the change each time)
206| 
207| No backup is created when renaming (the content doesn't change), when
208| creating a brand-new file (there's nothing to back up yet), or when
209| deleting an entire folder (a single `.bak` cannot represent a folder's
210| contents).
211| 
212| ## Project structure
213| 
214| ```
215| src/
216|   main.rs      – HTTP routes and server setup: directory tree, folder
217|                  selection (/api/browse), create folder
218|                  (/api/folder/create), read/save/create/rename/delete
219|                  file, filesystem watching as Server-Sent Events
220|                  (/api/watch), image preview (/api/image), table preview
221|                  (/api/table), compiling (/api/compile), diff creation
222|                  (/api/latexdiff), reading BibTeX as well as creating/
223|                  editing/deleting individual entries
224|                  (/api/bib/entry/create, /api/bib/entry,
225|                  /api/bib/entry/delete)
226|   tree.rs      – Recursive directory tree for the working folder
227|   watch.rs     – Recursively watches a folder for filesystem changes
228|                  (via the `notify` library, inotify on Linux) and reports
229|                  them back debounced (300 ms) through a channel; shuts
230|                  down cleanly as soon as the SSE client disconnects
231|   bibtex.rs    – Simple, brace-tolerant BibTeX parser
232|   table.rs     – Reads .xlsx/.xls/.xlsb/.ods via the `calamine` library,
233|                  and .csv via its own quote-aware parser (with comma/
234|                  semicolon detection) into a unified header/row structure
235|   compile.rs   – pdflatex/bibtex pipeline (with -file-line-error)
236|                  including log parsing into structured errors/warnings
237|                  with line numbers
238|   latexdiff.rs – Invokes the external `latexdiff` command-line tool and
239|                  writes its output as a new .tex file
240|                  (`diff-<old>-vs-<new>.tex`) next to the editor file
241|   project.rs   – Save/load project configurations (JSON files)
242|   static/
243|   index.html   – Page structure (toolbar + 4 areas with headers and, in
244|                  some cases, footers + dialogs + context menus)
245|   style.css    – Layout (10% / 40% / 40% / 10%) and styling; the headers
246|                  and footers of all areas use the same CSS variable
247|                  (--area-header-height) for a consistent height
248|   app.js       – Frontend logic (fetch calls, tree with type-matching
249|                  icons and expand/collapse, synchronized live with the
250|                  filesystem via Server-Sent Events, CodeMirror, tabs,
251|                  folder selection dialog, context menus, image/table
252|                  preview, drag-and-drop insertion of \figure/\table/\cite,
253|                  automatic saving every 5 minutes, search/replace with
254|                  match highlighting, LaTeX autocompletion, diff creation)
255|   vendor/codemirror/ – Locally embedded CodeMirror 5 files (JS/CSS,
256|                  including LaTeX mode, the Eclipse theme, the
257|                  search-cursor addon for the search/replace bar, and the
258|                  hint addon for LaTeX autocompletion). Deliberately NOT
259|                  loaded via CDN, so the editor loads reliably regardless
260|                  of external network reachability (firewalls, ad
261|                  blockers, offline use).
262|   projects/      – Stored project configurations (created automatically next to the binary at runtime)
263| ```
264| 
265| ## Known limitations
266| 
267| - The folder path is entered as text (no native browser file dialog),
268|   since the server needs direct access to the local filesystem.
269| - The BibTeX parser covers the common cases (nested braces, quotation
270|   marks, bare numeric values), but not `@string` macros.
271| - When dragging a table file into the editor, its content is loaded via a
272|   brief synchronous request to the server (technically necessary so the
273|   data is still available within the same drag operation by the time it's
274|   needed); for very large files this can cause a brief stutter while
275|   dragging. A plain preview without this delay only needs a double-click.
276| - The server is not designed for multi-user operation — it serves as a
277|   local tool for a single LaTeX project at a time.
278| - `.bak` backups are stored in the same folder as the original file and
279|   therefore also appear in the folder tree (area 1). This is intentional
280|   (transparency), but can be visually noticeable with a lot of changes.
281| 
282| ## Note on a fixed bug (PDF preview)
283| 
284| Earlier versions loaded CodeMirror via a CDN (`cdnjs.cloudflare.com`). If
285| that CDN was unreachable (firewall, ad blocker, offline use), editor
286| initialization failed *before* the app had remembered the open file
287| path — with the result that "Compile" apparently failed for no reason
288| with "Please select a .tex file first" and no PDF was ever produced.
289| CodeMirror is now bundled locally (`static/vendor/`) and therefore loads
290| with no external network dependency at all; in addition, the app now
291| remembers the open file path regardless of whether the editor display
292| itself could be built successfully.
293| 
294| In addition, `/api/pdf` (and `/api/image`) previously sent no
295| `Content-Disposition` header. Without this header, some browsers leave
296| the "display inline vs. download" decision to a heuristic that, depending
297| on browser version, settings, or installed extensions, can result in a
298| download instead of display — the PDF tab then stayed empty and a
299| download dialog opened instead. Both endpoints now explicitly send
300| `Content-Disposition: inline`, which tells browsers unambiguously to
301| display the content directly.
302| 
303| ## Note on a fixed bug (invisible icons)
304| 
305| Earlier versions used Unicode emoji characters for all icons (file tree,
306| buttons, context menus, status messages). Their display depends on
307| whether a color emoji font is installed on the given system (e.g. "Noto
308|   Color Emoji" on Linux, bundled by default on Windows/macOS) — on many
309|   Linux server or minimal installations such a font is missing, which made
310|   all icons invisible even though the rest of the text displayed normally.
311| All icons are now implemented as an embedded SVG sprite (`<symbol>`
312| definitions at the top of `index.html`, referenced via `<use>`) and use
313| `currentColor`/CSS classes for coloring instead of emoji characters. This
314| makes them display identically on every system regardless of installed
315| fonts. As a side effect, the "New folder"/"New .tex file" buttons in the
316| header of area 1 were also removed, since the same functionality was
317| already available via the right-click context menu (see point 10 above).
318| 
319| ## Note on a fixed bug (binary only worked via `cargo run`)
320| 
321| Earlier versions served the frontend with `ServeDir::new("static")` and
322| stored projects in `projects/`. Both are relative paths, resolved against
323| the process's *current working directory* — not against the binary's
324| location and not against any environment variable. `cargo run` is
325| normally invoked from the project root, so it worked; starting the
326| compiled binary from another directory (e.g. from inside
327| `target/release/`) made the server start normally but answer every page
328| request with HTTP 404. The frontend is now embedded into the binary
329| (`include_dir`) and `projects/` is resolved relative to the executable.
330| 