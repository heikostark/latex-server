// ---------- Global state ----------
const state = {
  workingDir: "",
  currentTexPath: null,
  currentBibPath: null,
  bibEntries: [],
  dirty: false,
  selectedTreePath: null, // file selected in the working folder via a single click (e.g. for latexdiff)
  expandedPaths: new Set(), // expanded subfolders in the working folder tree (default: all collapsed)
  lastPdfPage: 1, // PDF page shown before the last compile (see compileCurrentFile)
};

// ---------- Elements ----------
const el = {
  projectName: document.getElementById("projectName"),
  projectSelect: document.getElementById("projectSelect"),
  workingDirInput: document.getElementById("workingDirInput"),
  btnOpenFolder: document.getElementById("btnOpenFolder"),
  btnBrowseFolder: document.getElementById("btnBrowseFolder"),
  btnLoadProject: document.getElementById("btnLoadProject"),
  btnSaveProject: document.getElementById("btnSaveProject"),
  btnSaveFile: document.getElementById("btnSaveFile"),
  btnCompile: document.getElementById("btnCompile"),
  statusMsg: document.getElementById("statusMsg"),
  fileTree: document.getElementById("fileTree"),
  editorContainer: document.getElementById("editorContainer"),
  editorPlaceholder: document.getElementById("editorPlaceholder"),
  editorTitle: document.getElementById("editorTitle"),
  pdfFrame: document.getElementById("pdfFrame"),
  tabPdf: document.getElementById("tab-pdf"),
  tabErrors: document.getElementById("tab-errors"),
  bibList: document.getElementById("bibList"),
  folderModal: document.getElementById("folderModal"),
  modalCurrentPath: document.getElementById("modalCurrentPath"),
  modalDirList: document.getElementById("modalDirList"),
  modalUp: document.getElementById("modalUp"),
  modalCancel: document.getElementById("modalCancel"),
  modalSelect: document.getElementById("modalSelect"),
  btnLatexDiff: document.getElementById("btnLatexDiff"),
  contextMenu: document.getElementById("contextMenu"),
  imageModal: document.getElementById("imageModal"),
  imageModalTitle: document.getElementById("imageModalTitle"),
  imagePreview: document.getElementById("imagePreview"),
  imageModalClose: document.getElementById("imageModalClose"),
  bibContextMenu: document.getElementById("bibContextMenu"),
  bibEditModal: document.getElementById("bibEditModal"),
  bibEditTitle: document.getElementById("bibEditTitle"),
  bibEditTextarea: document.getElementById("bibEditTextarea"),
  bibEditCancel: document.getElementById("bibEditCancel"),
  bibEditSave: document.getElementById("bibEditSave"),
  tableModal: document.getElementById("tableModal"),
  tableModalTitle: document.getElementById("tableModalTitle"),
  tableModalBody: document.getElementById("tableModalBody"),
  tableModalClose: document.getElementById("tableModalClose"),
  btnNewBibEntry: document.getElementById("btnNewBibEntry"),
  searchInput: document.getElementById("searchInput"),
  replaceInput: document.getElementById("replaceInput"),
  btnFindPrev: document.getElementById("btnFindPrev"),
  btnFindNext: document.getElementById("btnFindNext"),
  btnReplaceOne: document.getElementById("btnReplaceOne"),
  btnReplaceAll: document.getElementById("btnReplaceAll"),
  searchMatchCount: document.getElementById("searchMatchCount"),
  btnUndo: document.getElementById("btnUndo"),
  btnRedo: document.getElementById("btnRedo"),
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "bmp", "webp", "ico", "tif", "tiff"];
const TABLE_EXTENSIONS = ["xlsx", "xls", "xlsm", "xlsb", "ods", "csv"];
const TEX_TEXT_EXTENSIONS = ["tex", "txt"];

function fileExtension(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

function isImageFile(name) {
  return IMAGE_EXTENSIONS.includes(fileExtension(name));
}

function isTableFile(name) {
  return TABLE_EXTENSIONS.includes(fileExtension(name));
}

function isTexOrTextFile(name) {
  return TEX_TEXT_EXTENSIONS.includes(fileExtension(name));
}

/// Returns an icon matching the file type; for folders it depends on the
/// expanded/collapsed state (open/closed folder).
/// Returns the matching SVG symbol (id in the icon sprite) plus a CSS
/// class for coloring by file type. Deliberately no emoji text (see the
/// comment next to the icon sprite in index.html) — this works regardless
/// of whether a color emoji font is installed on the system.
function iconForNode(node, isExpanded) {
  if (node.is_dir) {
    return isExpanded
      ? { symbol: "icon-folder-open", cls: "icon-folder" }
      : { symbol: "icon-folder", cls: "icon-folder" };
  }

  const ext = fileExtension(node.name);
  if (ext === "tex") return { symbol: "icon-file-lines", cls: "icon-tex" };
  if (ext === "bib") return { symbol: "icon-file-lines", cls: "icon-bib" };
  if (ext === "pdf") return { symbol: "icon-file", cls: "icon-pdf" };
  if (IMAGE_EXTENSIONS.includes(ext)) return { symbol: "icon-file-image", cls: "icon-image" };
  if (TABLE_EXTENSIONS.includes(ext)) return { symbol: "icon-file-grid", cls: "icon-table" };
  if (ext === "txt") return { symbol: "icon-file-lines", cls: "icon-generic" };
  if (["sty", "cls", "cfg", "def"].includes(ext)) return { symbol: "icon-file", cls: "icon-config" };
  if (ext === "log") return { symbol: "icon-file-lines", cls: "icon-log" };
  if (["aux", "toc", "out", "lof", "lot", "bbl", "blg", "synctex", "fls", "fdb_latexmk", "gz"].includes(ext)) {
    return { symbol: "icon-file", cls: "icon-build" }; // typical LaTeX build byproducts
  }
  if (ext === "bak") return { symbol: "icon-file", cls: "icon-backup" };
  return { symbol: "icon-file", cls: "icon-generic" };
}

/// Builds the <svg><use></use></svg> markup for an icon from the sprite.
function iconSvgHtml(symbol, extraClass) {
  const cls = extraClass ? `icon ${extraClass}` : "icon";
  return `<svg class="${cls}"><use href="#${symbol}"></use></svg>`;
}

// ---------- LaTeX autocompletion ----------

// Common LaTeX commands. Filtered against the last "\" before the cursor.
const LATEX_COMMANDS = [
  "\\documentclass", "\\usepackage", "\\begin", "\\end",
  "\\part", "\\chapter", "\\section", "\\subsection", "\\subsubsection", "\\paragraph", "\\subparagraph",
  "\\textbf", "\\textit", "\\texttt", "\\textsc", "\\textsf", "\\textrm", "\\emph", "\\underline",
  "\\footnote", "\\footnotetext",
  "\\cite", "\\citep", "\\citet", "\\ref", "\\eqref", "\\pageref", "\\label",
  "\\includegraphics", "\\caption", "\\item",
  "\\tableofcontents", "\\listoffigures", "\\listoftables",
  "\\maketitle", "\\author", "\\title", "\\date", "\\thanks",
  "\\newcommand", "\\renewcommand", "\\providecommand", "\\newenvironment",
  "\\frac", "\\dfrac", "\\sqrt", "\\sum", "\\prod", "\\int", "\\oint", "\\lim", "\\infty",
  "\\partial", "\\nabla", "\\times", "\\cdot", "\\pm", "\\mp", "\\leq", "\\geq", "\\neq", "\\approx",
  "\\alpha", "\\beta", "\\gamma", "\\delta", "\\epsilon", "\\varepsilon", "\\zeta", "\\eta", "\\theta",
  "\\iota", "\\kappa", "\\lambda", "\\mu", "\\nu", "\\xi", "\\pi", "\\rho", "\\sigma", "\\tau",
  "\\upsilon", "\\phi", "\\varphi", "\\chi", "\\psi", "\\omega",
  "\\Gamma", "\\Delta", "\\Theta", "\\Lambda", "\\Xi", "\\Pi", "\\Sigma", "\\Upsilon", "\\Phi", "\\Psi", "\\Omega",
  "\\left", "\\right", "\\big", "\\Big",
  "\\bibliography", "\\bibliographystyle", "\\bibitem",
  "\\newpage", "\\clearpage", "\\noindent", "\\indent", "\\vspace", "\\hspace", "\\vfill", "\\hfill",
  "\\centering", "\\raggedright", "\\raggedleft",
  "\\hline", "\\toprule", "\\midrule", "\\bottomrule", "\\multicolumn", "\\multirow",
  "\\input", "\\include", "\\usetikzlibrary",
];

// Environment names for \begin{...} / \end{...}.
const LATEX_ENVIRONMENTS = [
  "document", "itemize", "enumerate", "description",
  "figure", "table", "tabular", "tabularx", "array",
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "center", "flushleft", "flushright", "quote", "quotation", "verbatim", "verse",
  "abstract", "minipage", "thebibliography",
];

/// Custom CodeMirror hint function: depending on context, suggests either
/// LaTeX environment names (after "\begin{"/"\end{") or LaTeX commands
/// (after the last "\").
function latexHint(editor) {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  const beforeCursor = line.slice(0, cursor.ch);

  const envMatch = beforeCursor.match(/\\(?:begin|end)\{([a-zA-Z*]*)$/);
  if (envMatch) {
    const partial = envMatch[1];
    const list = LATEX_ENVIRONMENTS.filter((e) => e.toLowerCase().startsWith(partial.toLowerCase()));
    if (list.length === 0) return null;
    return {
      list,
      from: CodeMirror.Pos(cursor.line, cursor.ch - partial.length),
      to: CodeMirror.Pos(cursor.line, cursor.ch),
    };
  }

  const cmdMatch = beforeCursor.match(/\\([a-zA-Z]*)$/);
  if (cmdMatch) {
    const partial = "\\" + cmdMatch[1];
    const list = LATEX_COMMANDS.filter((c) => c.toLowerCase().startsWith(partial.toLowerCase()));
    if (list.length === 0) return null;
    return {
      list,
      from: CodeMirror.Pos(cursor.line, cursor.ch - partial.length),
      to: CodeMirror.Pos(cursor.line, cursor.ch),
    };
  }

  return null;
}

// ---------- CodeMirror editor (area 2) ----------

let cm = null;

function initEditor() {
  if (cm) return cm;
  el.editorPlaceholder.remove();

  if (typeof CodeMirror !== "undefined") {
    try {
      cm = CodeMirror(el.editorContainer, {
        mode: "stex",
        theme: "eclipse",
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        indentUnit: 2,
        tabSize: 2,
        dragDrop: true, // allows dropping dragged text (e.g. \cite{}) at the mouse position
        extraKeys: { "Ctrl-Space": "autocomplete" },
        hintOptions: { hint: latexHint, completeSingle: false },
        // Custom gutter for error/warning icons next to the line numbers.
        gutters: ["CodeMirror-linenumbers", "cm-issue-gutter"],
        value: "",
      });
      cm.on("change", () => {
        state.dirty = true;
      });
      // Automatically suggest LaTeX commands/environments while typing
      // (in addition to Ctrl+Space for manual invocation).
      cm.on("inputRead", (instance, changeObj) => {
        if (typeof CodeMirror.showHint !== "function") return;
        if (!changeObj.text || changeObj.text.length !== 1) return;
        if (!/[a-zA-Z{]/.test(changeObj.text[0])) return;

        const cursor = instance.getCursor();
        const before = instance.getLine(cursor.line).slice(0, cursor.ch);
        if (/\\[a-zA-Z]*$/.test(before) || /\\(?:begin|end)\{[a-zA-Z*]*$/.test(before)) {
          CodeMirror.showHint(instance, latexHint, { completeSingle: false });
        }
      });
      return cm;
    } catch (e) {
      console.error("CodeMirror initialization failed, using plain text editor:", e);
    }
  }

  // Fallback editor: a plain <textarea> in case CodeMirror is unavailable
  // for some reason (e.g. a missing local vendor file). Offers the same
  // small API (getValue/setValue/on/replaceSelection/focus/clearHistory/
  // refresh) so the rest of the code keeps working unchanged — just
  // without syntax highlighting.
  setStatus("Note: editor library could not be loaded — using a plain text editor instead.", true);
  const textarea = document.createElement("textarea");
  textarea.className = "fallback-editor";
  textarea.spellcheck = false;
  el.editorContainer.appendChild(textarea);

  cm = {
    getValue: () => textarea.value,
    setValue: (v) => {
      textarea.value = v;
    },
    clearHistory: () => {},
    refresh: () => {},
    focus: () => textarea.focus(),
    replaceSelection: (text) => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
      const newPos = start + text.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.dispatchEvent(new Event("input"));
    },
    on: (event, cb) => {
      if (event === "change") textarea.addEventListener("input", cb);
    },
    // Best-effort approximation of undo/redo without CodeMirror: uses the
    // browser's native undo stack for text fields. Not guaranteed in every
    // browser, but widely supported.
    undo: () => {
      textarea.focus();
      try {
        document.execCommand("undo");
      } catch (e) {
        /* execCommand not available — no action possible */
      }
    },
    redo: () => {
      textarea.focus();
      try {
        document.execCommand("redo");
      } catch (e) {
        /* execCommand not available — no action possible */
      }
    },
    // No real cursor-based search available in the fallback editor;
    // getSearchCursor is deliberately left undefined so the search
    // functions can detect that they cannot operate in fallback mode.
  };
  return cm;
}

// Visual feedback while a citation is being dragged over the editor.
el.editorContainer.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.editorContainer.classList.add("drag-over");
});
el.editorContainer.addEventListener("dragleave", () => {
  el.editorContainer.classList.remove("drag-over");
});
el.editorContainer.addEventListener("drop", () => {
  el.editorContainer.classList.remove("drag-over");
  state.dirty = true;
});

// ---------- Search & replace (editor footer) ----------

function searchSupported() {
  return !!cm && typeof cm.getSearchCursor === "function";
}

// All currently marked matches (CodeMirror TextMarker), so they can be
// cleared before a recalculation.
let searchMarkers = [];

function clearSearchMarkers() {
  searchMarkers.forEach((m) => m.clear());
  searchMarkers = [];
}

/// Highlights EVERY match of the current search term in the editor (not
/// just the currently selected one) and updates the match count. Called
/// again on every change to the search field as well as after
/// replacements, since match positions can shift then.
function refreshSearchHighlights() {
  clearSearchMarkers();
  const query = el.searchInput.value;
  if (!searchSupported() || !query) {
    el.searchMatchCount.textContent = "";
    return;
  }
  let count = 0;
  const cursor = cm.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });
  while (cursor.findNext()) {
    searchMarkers.push(cm.markText(cursor.from(), cursor.to(), { className: "cm-search-match" }));
    count++;
  }
  el.searchMatchCount.textContent = count > 0 ? `${count} match${count === 1 ? "" : "es"}` : "No matches";
}

function performFind(direction = 1) {
  if (!cm) {
    setStatus("Please open a file in the editor first.", true);
    return;
  }
  if (!searchSupported()) {
    setStatus("Search is not available in the plain fallback editor.", true);
    return;
  }
  const query = el.searchInput.value;
  if (!query) return;

  const startPos = direction > 0 ? cm.getCursor("to") : cm.getCursor("from");
  let cursor = cm.getSearchCursor(query, startPos, { caseFold: true });
  let found = direction > 0 ? cursor.findNext() : cursor.findPrevious();

  if (!found) {
    // No further match in this direction — wrap around from the start/end.
    const wrapPos =
      direction > 0
        ? { line: 0, ch: 0 }
        : { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length };
    cursor = cm.getSearchCursor(query, wrapPos, { caseFold: true });
    found = direction > 0 ? cursor.findNext() : cursor.findPrevious();
  }

  if (found) {
    cm.setSelection(cursor.from(), cursor.to());
    cm.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 60);
  } else {
    setStatus(`No match for "${query}".`, true);
  }
}

function replaceCurrent() {
  if (!searchSupported()) {
    setStatus("Replace is not available in the plain fallback editor.", true);
    return;
  }
  const query = el.searchInput.value;
  if (!query) return;

  const selected = cm.getSelection();
  if (selected && selected.toLowerCase() === query.toLowerCase()) {
    cm.replaceSelection(el.replaceInput.value);
    state.dirty = true;
  }
  refreshSearchHighlights();
  performFind(1);
}

function replaceAllMatches() {
  if (!searchSupported()) {
    setStatus("Replace is not available in the plain fallback editor.", true);
    return;
  }
  const query = el.searchInput.value;
  if (!query) return;
  const replacement = el.replaceInput.value;
  let count = 0;

  cm.operation(() => {
    const cursor = cm.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });
    while (cursor.findNext()) {
      cursor.replace(replacement);
      count++;
    }
  });

  if (count > 0) state.dirty = true;
  setStatus(count > 0 ? `${count} replacement${count === 1 ? "" : "s"} made.` : `No match for "${query}".`, count === 0);
  refreshSearchHighlights();
}

el.btnFindNext.addEventListener("click", () => performFind(1));
el.btnFindPrev.addEventListener("click", () => performFind(-1));
el.btnReplaceOne.addEventListener("click", () => replaceCurrent());
el.btnReplaceAll.addEventListener("click", () => replaceAllMatches());

el.searchInput.addEventListener("input", () => refreshSearchHighlights());
el.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    performFind(e.shiftKey ? -1 : 1);
  }
});
el.replaceInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    replaceCurrent();
  }
});

// ---------- Undo / redo (editor footer) ----------

el.btnUndo.addEventListener("click", () => {
  if (!cm) {
    setStatus("Please open a file in the editor first.", true);
    return;
  }
  if (typeof cm.undo === "function") cm.undo();
});

el.btnRedo.addEventListener("click", () => {
  if (!cm) {
    setStatus("Please open a file in the editor first.", true);
    return;
  }
  if (typeof cm.redo === "function") cm.redo();
});

// ---------- Helper functions ----------

function setStatus(msg, isError = false) {
  el.statusMsg.textContent = msg;
  el.statusMsg.classList.toggle("error", isError);
  if (!isError) {
    setTimeout(() => {
      if (el.statusMsg.textContent === msg) el.statusMsg.textContent = "";
    }, 4000);
  }
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res;
}

async function apiPostJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

function joinPath(dir, name) {
  if (dir.endsWith("/")) return dir + name;
  return dir + "/" + name;
}

// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

function showTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === tabId));
}

// ---------- Working folder / file tree (area 1) ----------

el.btnOpenFolder.addEventListener("click", async () => {
  const dir = el.workingDirInput.value.trim();
  if (!dir) {
    setStatus("Please enter a folder path.", true);
    return;
  }
  await openWorkingDir(dir);
});

// ---------- Folder selection dialog ----------

let modalCurrentDir = null;

el.btnBrowseFolder.addEventListener("click", () => {
  openFolderModal(el.workingDirInput.value.trim() || state.workingDir || null);
});

el.modalCancel.addEventListener("click", closeFolderModal);
el.folderModal.addEventListener("click", (e) => {
  if (e.target === el.folderModal) closeFolderModal(); // click on the backdrop
});
el.modalUp.addEventListener("click", () => {
  if (modalCurrentDir) browseModalTo(modalCurrentDir, true);
});
el.modalSelect.addEventListener("click", async () => {
  if (!modalCurrentDir) return;
  closeFolderModal();
  await openWorkingDir(modalCurrentDir);
});

function openFolderModal(startDir) {
  el.folderModal.style.display = "flex";
  browseModalTo(startDir, false);
}

function closeFolderModal() {
  el.folderModal.style.display = "none";
}

async function browseModalTo(dir, goToParent) {
  try {
    const url = dir ? `/api/browse?dir=${encodeURIComponent(dir)}` : "/api/browse";
    const res = await apiGet(url);
    const data = await res.json();

    if (goToParent && data.parent) {
      // Navigate one level up: reload with the parent folder.
      await browseModalTo(data.parent, false);
      return;
    }

    modalCurrentDir = data.current;
    el.modalCurrentPath.value = data.current;
    el.modalUp.disabled = !data.parent;
    renderModalDirs(data.dirs);
  } catch (e) {
    setStatus(`Error while browsing: ${e.message}`, true);
  }
}

function renderModalDirs(dirs) {
  el.modalDirList.innerHTML = "";
  if (dirs.length === 0) {
    el.modalDirList.innerHTML = `<p class="hint">No subfolders.</p>`;
    return;
  }
  dirs.forEach((d) => {
    const item = document.createElement("div");
    item.className = "modal-dir-item";
    item.innerHTML = `${iconSvgHtml("icon-folder", "icon-folder")} ${escapeHtml(d.name)}`;
    item.addEventListener("click", () => browseModalTo(d.path, false));
    el.modalDirList.appendChild(item);
  });
}

async function openWorkingDir(dir) {
  try {
    const res = await apiGet(`/api/tree?dir=${encodeURIComponent(dir)}`);
    const tree = await res.json();
    state.workingDir = dir;
    state.expandedPaths = new Set(); // new folder: collapse all subfolders again
    el.workingDirInput.value = dir;
    renderTree(tree);
    setStatus(`Folder opened: ${dir}`);
    await autoLoadBibFile(tree);
    startWatchingWorkingDir(dir);
  } catch (e) {
    setStatus(`Error opening the folder: ${e.message}`, true);
  }
}

// ---------- Filesystem watcher (automatic synchronization) ----------

// Server-Sent Events connection that keeps the folder tree automatically
// up to date whenever something changes in the working folder outside the
// app (files created/changed/deleted — including in subfolders).
let treeWatchSource = null;

function stopWatchingWorkingDir() {
  if (treeWatchSource) {
    treeWatchSource.close();
    treeWatchSource = null;
  }
}

function startWatchingWorkingDir(dir) {
  stopWatchingWorkingDir();
  if (!dir || typeof EventSource === "undefined") return;
  try {
    treeWatchSource = new EventSource(`/api/watch?dir=${encodeURIComponent(dir)}`);
    treeWatchSource.addEventListener("change", () => {
      refreshTree();
    });
    treeWatchSource.onerror = () => {
      // Connection lost (e.g. server briefly restarted) — the browser
      // automatically tries to reconnect for EventSource.
    };
  } catch (e) {
    console.error("Filesystem watcher could not be started:", e);
  }
}

function renderTree(node) {
  el.fileTree.innerHTML = "";
  const rootUl = document.createElement("ul");
  rootUl.appendChild(renderNode(node, true));
  el.fileTree.appendChild(rootUl);
}

// Briefly delays actually setting state.selectedTreePath so that a
// double-click (which first fires two normal "click" events before
// "dblclick") does not accidentally overwrite a deliberately made tree
// selection when opening a file in the editor. Each tree node gets its
// own timer for this (see renderNode).

function renderNode(node, isRoot = false) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = "tree-item" + (node.is_dir ? " dir" : "");
  span.dataset.path = node.path;
  span.dataset.isDir = node.is_dir ? "1" : "0";
  span.dataset.name = node.name;
  // For files: the directory they live in (for "New file here" in the context menu).
  span.dataset.parentDir = node.is_dir ? node.path : state.workingDir;

  const hasChildren = node.is_dir && node.children && node.children.length > 0;
  // The working folder (root) is always expanded; all subfolders remember
  // their state in state.expandedPaths (default: collapsed).
  const isExpanded = isRoot || state.expandedPaths.has(node.path);

  // Expand/collapse arrow (only for folders with content); for files and
  // empty folders it stays as an invisible placeholder so all labels
  // start at the same horizontal position.
  const toggle = document.createElement("span");
  toggle.className = "tree-toggle";
  if (hasChildren && !isRoot) toggle.textContent = isExpanded ? "▼" : "▶";
  span.appendChild(toggle);

  const label = document.createElement("span");
  label.className = "tree-label";
  const iconSpan = document.createElement("span");
  iconSpan.className = "tree-icon";
  const iconInfo = iconForNode(node, isExpanded);
  iconSpan.innerHTML = iconSvgHtml(iconInfo.symbol, iconInfo.cls);
  label.appendChild(iconSpan);
  const nameSpan = document.createElement("span");
  nameSpan.textContent = node.name;
  label.appendChild(nameSpan);
  span.appendChild(label);

  // Own timer, independent per node, for the delayed selection (see
  // comment above) — important: NOT global/shared, otherwise a
  // double-click on file B would cancel the still-pending selection
  // timer of file A.
  let selectTimer = null;

  if (!node.is_dir) {
    span.title = fileInteractionHint(node.name);

    // A single click marks the file visually right away; actually setting
    // state.selectedTreePath is briefly delayed and cancelled if a
    // subsequent double-click happens on THIS file (see dblclick below). A
    // double-click on a DIFFERENT file does not touch this timer, since it
    // is independent per node.
    span.addEventListener("click", () => {
      document.querySelectorAll(".tree-item.selected").forEach((e) => e.classList.remove("selected"));
      span.classList.add("selected");
      if (selectTimer) clearTimeout(selectTimer);
      selectTimer = setTimeout(() => {
        state.selectedTreePath = node.path;
        selectTimer = null;
      }, 280);
    });

    // Double-click is the unified "open" action, depending on file type:
    // .tex/.txt → editor · .bib → citation view · images/tables → preview.
    // The still-pending selection update for this file (see click above) is
    // cancelled here, so "open" does not simultaneously change the
    // comparison file remembered for latexdiff to itself.
    span.addEventListener("dblclick", () => {
      if (selectTimer) {
        clearTimeout(selectTimer);
        selectTimer = null;
      }
      handleFileOpen(node);
    });

    // Images and tables can also be dragged into the editor.
    if (isImageFile(node.name) || isTableFile(node.name)) {
      span.draggable = true;
      span.addEventListener("dragstart", (e) => handleTreeDragStart(e, node, span));
      span.addEventListener("dragend", () => span.classList.remove("dragging"));
    }
  }

  span.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, {
      path: node.path,
      name: node.name,
      isDir: node.is_dir,
      parentDir: node.is_dir ? node.path : state.workingDir,
      isRoot: isRoot, // The working folder itself must not be renamed/deleted.
    });
  });

  li.appendChild(span);

  let childUl = null;
  if (hasChildren) {
    childUl = document.createElement("ul");
    childUl.className = "tree-children" + (isExpanded ? "" : " collapsed");
    node.children.forEach((child) => childUl.appendChild(renderNode(child)));
    li.appendChild(childUl);
  }

  // Clicking a folder with content expands/collapses it (the root folder
  // itself is excluded from this and is always expanded).
  if (hasChildren && !isRoot) {
    span.addEventListener("click", () => {
      const nowCollapsed = childUl.classList.toggle("collapsed");
      if (nowCollapsed) {
        state.expandedPaths.delete(node.path);
        toggle.textContent = "▶";
        iconSpan.innerHTML = iconSvgHtml("icon-folder", "icon-folder");
      } else {
        state.expandedPaths.add(node.path);
        toggle.textContent = "▼";
        iconSpan.innerHTML = iconSvgHtml("icon-folder-open", "icon-folder");
      }
    });
  }

  return li;
}

async function handleFileOpen(node) {
  const ext = fileExtension(node.name);

  if (isTexOrTextFile(node.name)) {
    document.querySelectorAll(".tree-item.selected").forEach((e) => e.classList.remove("selected"));
    await loadTexFile(node.path);
  } else if (ext === "bib") {
    document.querySelectorAll(".tree-item.selected").forEach((e) => e.classList.remove("selected"));
    await loadBibFile(node.path);
  } else if (isImageFile(node.name)) {
    openImagePreview(node);
  } else if (isTableFile(node.name)) {
    await openTablePreview(node);
  } else if (ext === "pdf") {
    window.open(`/api/pdf?path=${encodeURIComponent(node.path)}`, "_blank", "noopener,noreferrer");
    setStatus(`PDF opened: ${node.name}`);
  } else {
    setStatus(`No open/preview action defined for "${node.name}".`, true);
  }
}

function fileInteractionHint(name) {
  if (isTexOrTextFile(name)) return "Double-click: open in editor · Right-click: more options";
  if (fileExtension(name) === "bib") return "Double-click: show citations · Right-click: more options";
  if (isImageFile(name)) {
    return "Double-click: open preview · Drag into editor: insert \\figure · Right-click: more options";
  }
  if (isTableFile(name)) {
    return "Double-click: open preview · Drag into editor: insert \\table · Right-click: more options";
  }
  if (fileExtension(name) === "pdf") return "Double-click: open PDF · Right-click: more options";
  return "Right-click: more options";
}

// ---------- Dragging images/tables into the editor ----------

function handleTreeDragStart(e, node, spanEl) {
  let snippet;
  if (isImageFile(node.name)) {
    snippet = buildFigureSnippet(node.path);
  } else if (isTableFile(node.name)) {
    snippet = buildTableSnippet(node.path, node.name);
  } else {
    return;
  }
  e.dataTransfer.setData("text/plain", snippet);
  e.dataTransfer.effectAllowed = "copy";
  spanEl.classList.add("dragging");
}

/// Directory relative to which inserted paths (\includegraphics etc.) are
/// resolved: the directory of the currently open .tex file, or the
/// working folder as a fallback.
function referenceDir() {
  if (state.currentTexPath) {
    const idx = state.currentTexPath.lastIndexOf("/");
    return idx === -1 ? state.currentTexPath : state.currentTexPath.slice(0, idx);
  }
  return state.workingDir;
}

/// Computes the relative path from a directory to a target file (both as
/// absolute, "/"-separated paths).
function relativePath(fromDir, toPath) {
  if (!fromDir) return toPath;
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toPath.split("/").filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const upCount = fromParts.length - i;
  const downParts = toParts.slice(i);
  return new Array(upCount).fill("..").concat(downParts).join("/");
}

/// Builds a \label{}-suitable identifier from a file name.
function sanitizeLabel(name) {
  const base = name.replace(/\.[^./]+$/, "");
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "file";
}

function buildFigureSnippet(imagePath) {
  const rel = relativePath(referenceDir(), imagePath);
  const label = sanitizeLabel(imagePath.split("/").pop());
  return (
    `\\begin{figure}[htbp]\n` +
    `    \\centering\n` +
    `    \\includegraphics[width=0.8\\textwidth]{${rel}}\n` +
    `    \\caption{TODO: description}\n` +
    `    \\label{fig:${label}}\n` +
    `\\end{figure}\n`
  );
}

/// Escapes LaTeX special characters in cell values so the inserted table
/// remains compilable.
function escapeLatex(value) {
  return String(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/// Synchronous GET (blocks briefly, deliberately only used when starting to
/// drag a table file, so the cell values can still be written to
/// dataTransfer within the same dragstart event — an asynchronous fetch
/// would be too late for that).
function fetchJsonSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send(null);
  if (xhr.status < 200 || xhr.status >= 300) {
    let message = xhr.statusText || `HTTP ${xhr.status}`;
    try {
      const body = JSON.parse(xhr.responseText);
      if (body.error) message = body.error;
    } catch (e) {
      /* Response was not JSON — keep the status text. */
    }
    throw new Error(message);
  }
  return JSON.parse(xhr.responseText);
}

const MAX_TABLE_INSERT_ROWS = 20;

function buildTableSnippet(path, name) {
  let data;
  try {
    data = fetchJsonSync(`/api/table?path=${encodeURIComponent(path)}`);
  } catch (e) {
    setStatus(`Error reading table "${name}": ${e.message}`, true);
    return `% Error reading ${name}: ${e.message}\n`;
  }

  const headers = data.headers;
  const usedRows = data.rows.slice(0, MAX_TABLE_INSERT_ROWS);
  const colSpec = headers.map(() => "l").join("") || "l";
  const label = sanitizeLabel(name);

  const headerLine = headers.map(escapeLatex).join(" & ") + " \\\\";
  const bodyLines = usedRows.map((row) => row.map(escapeLatex).join(" & ") + " \\\\").join("\n        ");
  const truncNote =
    data.total_rows > usedRows.length
      ? `    % Note: only the first ${usedRows.length} of ${data.total_rows} rows were inserted.\n`
      : "";

  setStatus(`Table "${name}" inserted (${usedRows.length} of ${data.total_rows} rows).`);

  return (
    `% Requires \\usepackage{booktabs} in the preamble\n` +
    `\\begin{table}[htbp]\n` +
    `    \\centering\n` +
    `    \\caption{TODO: description}\n` +
    `    \\label{tab:${label}}\n` +
    truncNote +
    `    \\begin{tabular}{${colSpec}}\n` +
    `        \\toprule\n` +
    `        ${headerLine}\n` +
    `        \\midrule\n` +
    `        ${bodyLines}\n` +
    `        \\bottomrule\n` +
    `    \\end{tabular}\n` +
    `\\end{table}\n`
  );
}

// ---------- Table preview (double-click) ----------

async function openTablePreview(node) {
  setStatus(`Loading table "${node.name}" …`);
  try {
    const res = await apiGet(`/api/table?path=${encodeURIComponent(node.path)}`);
    const data = await res.json();
    renderTablePreview(node.name, data);
  } catch (e) {
    setStatus(`Error loading table: ${e.message}`, true);
  }
}

function renderTablePreview(name, data) {
  el.tableModalTitle.textContent = `${name} — ${data.sheet_name}`;

  const theadHtml = `<tr>${data.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const bodyHtml = data.rows
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

  el.tableModalBody.innerHTML = `<table class="preview-table"><thead>${theadHtml}</thead><tbody>${bodyHtml}</tbody></table>`;

  if (data.truncated) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = `Note: display limited to the first ${data.rows.length} of ${data.total_rows} rows.`;
    el.tableModalBody.appendChild(note);
  }

  el.tableModal.style.display = "flex";
  setStatus(`Table loaded: ${name}`);
}

function closeTableModal() {
  el.tableModal.style.display = "none";
  el.tableModalBody.innerHTML = "";
}

el.tableModalClose.addEventListener("click", closeTableModal);
el.tableModal.addEventListener("click", (e) => {
  if (e.target === el.tableModal) closeTableModal();
});

// ---------- Refresh tree ----------

async function refreshTree() {
  if (!state.workingDir) return;
  try {
    const res = await apiGet(`/api/tree?dir=${encodeURIComponent(state.workingDir)}`);
    const tree = await res.json();
    renderTree(tree);
  } catch (e) {
    setStatus(`Error refreshing the tree: ${e.message}`, true);
  }
}

// ---------- Image preview (double-click) ----------

function openImagePreview(node) {
  el.imageModalTitle.textContent = node.name;
  el.imagePreview.src = `/api/image?path=${encodeURIComponent(node.path)}&t=${Date.now()}`;
  el.imageModal.style.display = "flex";
}

function closeImageModal() {
  el.imageModal.style.display = "none";
  el.imagePreview.src = "";
}

el.imageModalClose.addEventListener("click", closeImageModal);
el.imageModal.addEventListener("click", (e) => {
  if (e.target === el.imageModal) closeImageModal();
});

// ---------- Context menu (right-click: New / Rename / Delete) ----------

let contextMenuTarget = null;

// Right-click on empty area of the file tree (not on an element) → only "New file here".
el.fileTree.addEventListener("contextmenu", (e) => {
  if (e.target.closest(".tree-item")) return; // handled by the element itself
  e.preventDefault();
  if (!state.workingDir) return;
  openContextMenu(e.clientX, e.clientY, { isRoot: true, parentDir: state.workingDir });
});

function openContextMenu(x, y, target) {
  contextMenuTarget = target;
  const isRoot = !!target.isRoot;

  el.contextMenu.querySelector('[data-action="new-folder"]').style.display = target.isDir || isRoot ? "" : "none";
  el.contextMenu.querySelector('[data-action="new-file"]').style.display = target.isDir || isRoot ? "" : "none";
  el.contextMenu.querySelector('[data-action="rename"]').style.display = isRoot ? "none" : "";
  el.contextMenu.querySelector('[data-action="delete"]').style.display = isRoot ? "none" : "";

  el.contextMenu.style.display = "block";
  // Keep the position within the visible area.
  const rect = el.contextMenu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
  el.contextMenu.style.left = `${Math.max(0, clampedX)}px`;
  el.contextMenu.style.top = `${Math.max(0, clampedY)}px`;
}

function closeContextMenu() {
  el.contextMenu.style.display = "none";
  contextMenuTarget = null;
}

document.addEventListener("click", (e) => {
  if (!el.contextMenu.contains(e.target)) closeContextMenu();
});
document.addEventListener("scroll", closeContextMenu, true);
window.addEventListener("blur", closeContextMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeContextMenu();
    closeImageModal();
    closeBibContextMenu();
    closeBibEditModal();
    closeTableModal();
  }
});

el.contextMenu.querySelectorAll(".context-menu-item").forEach((item) => {
  item.addEventListener("click", async () => {
    const action = item.dataset.action;
    const target = contextMenuTarget;
    closeContextMenu();
    if (!target) return;

    if (action === "new-folder") {
      await handleNewFolder(target.isRoot ? state.workingDir : target.parentDir);
    } else if (action === "new-file") {
      await handleNewFile(target.isRoot ? state.workingDir : target.parentDir);
    } else if (action === "rename") {
      await handleRename(target);
    } else if (action === "delete") {
      await handleDelete(target);
    }
  });
});

// ---------- Create new .tex file (from the context menu, see openContextMenu) ----------

async function handleNewFile(dir) {
  if (!dir) {
    setStatus("Please open a working folder first.", true);
    return;
  }
  const name = prompt("Name of the new .tex file:", "new-file.tex");
  if (!name) return;
  try {
    const result = await apiPostJson("/api/file/create", { dir, name });
    setStatus(`File created: ${result.path}`);
    await refreshTree();
    await loadTexFile(result.path);
  } catch (e) {
    setStatus(`Error creating the file: ${e.message}`, true);
  }
}

// ---------- Create new folder (from the context menu, see openContextMenu) ----------

async function handleNewFolder(dir) {
  if (!dir) {
    setStatus("Please open a working folder first.", true);
    return;
  }
  const name = prompt("Name of the new folder:", "new-folder");
  if (!name) return;
  try {
    const result = await apiPostJson("/api/folder/create", { dir, name });
    setStatus(`Folder created: ${result.path}`);
    // Show the newly created folder expanded right away (it's empty, but
    // this way you can see immediately that it's there without an extra click).
    state.expandedPaths.add(result.path);
    await refreshTree();
  } catch (e) {
    setStatus(`Error creating the folder: ${e.message}`, true);
  }
}

// ---------- Create diff (latexdiff) ----------

el.btnLatexDiff.addEventListener("click", () => handleLatexDiff());

async function handleLatexDiff() {
  if (!state.selectedTreePath) {
    setStatus("Please select a file in the working folder first (single click).", true);
    return;
  }
  if (!state.currentTexPath) {
    setStatus("Please open a file in the editor first.", true);
    return;
  }
  if (state.selectedTreePath === state.currentTexPath) {
    setStatus("Please select a different file in the working folder than the one open in the editor.", true);
    return;
  }

  // latexdiff reads from disk — so the current editor content is saved
  // first, so the diff matches what's shown in the editor (like compiling).
  await saveCurrentTexFile();

  setStatus("Generating diff …");
  try {
    const result = await apiPostJson("/api/latexdiff", {
      old_path: state.selectedTreePath,
      new_path: state.currentTexPath,
    });
    if (result.success && result.diff_path) {
      setStatus(`Diff created: ${result.diff_path.split("/").pop()}`);
      await refreshTree();
      await loadTexFile(result.diff_path);
    } else {
      setStatus(`Diff failed: ${result.log || "Unknown error"}`, true);
    }
  } catch (e) {
    setStatus(`Error generating the diff: ${e.message}`, true);
  }
}

// ---------- Rename ----------

async function handleRename(target) {
  const newName = prompt("New name:", target.name);
  if (!newName || newName === target.name) return;
  try {
    const result = await apiPostJson("/api/file/rename", { path: target.path, new_name: newName });
    setStatus(`Renamed to: ${newName}`);
    if (state.currentTexPath === target.path) state.currentTexPath = result.path;
    if (state.currentBibPath === target.path) state.currentBibPath = result.path;
    await refreshTree();
  } catch (e) {
    setStatus(`Error renaming: ${e.message}`, true);
  }
}

// ---------- Delete ----------

async function handleDelete(target) {
  const label = target.isDir ? "the folder (including its contents)" : "the file";
  if (!confirm(`Really delete ${label} "${target.name}"?`)) return;
  try {
    await apiPostJson("/api/file/delete", { path: target.path });
    setStatus(`Deleted: ${target.name}`);

    if (state.currentTexPath === target.path) {
      state.currentTexPath = null;
      if (cm) cm.setValue("");
      el.editorTitle.textContent = "Editor";
    }
    if (state.currentBibPath === target.path) {
      state.currentBibPath = null;
      state.bibEntries = [];
      renderBibEntries([]);
    }
    await refreshTree();
  } catch (e) {
    setStatus(`Error deleting: ${e.message}`, true);
  }
}

async function autoLoadBibFile(tree) {
  const bibPath = findFirstBib(tree);
  if (bibPath) {
    await loadBibFile(bibPath);
  }
}

function findFirstBib(node) {
  if (!node.is_dir && node.name.toLowerCase().endsWith(".bib")) return node.path;
  if (node.children) {
    for (const child of node.children) {
      const found = findFirstBib(child);
      if (found) return found;
    }
  }
  return null;
}

// ---------- LaTeX editor (area 2) ----------

async function loadTexFile(path) {
  let content;
  try {
    const res = await apiGet(`/api/file?path=${encodeURIComponent(path)}`);
    content = await res.text();
  } catch (e) {
    setStatus(`Error loading the file: ${e.message}`, true);
    return;
  }

  // The state is set as soon as the file content is available —
  // regardless of whether the (purely visual) editor display can be built
  // successfully afterward. This way, save/compile keep working reliably
  // even if the editor library could not be loaded for some reason.
  state.currentTexPath = path;
  state.dirty = false;
  el.editorTitle.textContent = "Editor — " + path.split("/").pop();

  try {
    const editor = initEditor();
    editor.setValue(content);
    editor.clearHistory();
    setTimeout(() => editor.refresh(), 0);
    // Reset search state and error/warning markers: they referred to the
    // previous file and are now meaningless.
    clearSearchMarkers();
    clearIssueMarks();
    el.searchMatchCount.textContent = "";
    setStatus(`File loaded: ${path}`);
  } catch (e) {
    setStatus(`File loaded, but editor display failed: ${e.message}`, true);
  }
}

el.btnSaveFile.addEventListener("click", () => saveCurrentTexFile());

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveCurrentTexFile();
  }
});

async function saveCurrentTexFile(isAutoSave = false) {
  if (!state.currentTexPath || !cm) {
    if (!isAutoSave) setStatus("No file selected to save.", true);
    return;
  }
  try {
    await apiPostJson("/api/file", { path: state.currentTexPath, content: cm.getValue() });
    state.dirty = false;
    setStatus(isAutoSave ? "Auto-saved." : "File saved.");
  } catch (e) {
    setStatus(`${isAutoSave ? "Auto-save" : "Save"} failed: ${e.message}`, true);
  }
}

// ---------- Auto-save (every 5 minutes) ----------

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  // Only save if a file is open and there are actually unsaved changes —
  // avoids unnecessary writes/backups.
  if (state.currentTexPath && state.dirty && cm) {
    saveCurrentTexFile(true);
  }
}, AUTOSAVE_INTERVAL_MS);

// ---------- Compile (area 3) ----------

el.btnCompile.addEventListener("click", () => compileCurrentFile());

/// Tries to read the page currently shown in the PDF viewer (only works if
/// the embedded browser PDF viewer reflects the page in the URL fragment
/// "#page=N" — not guaranteed depending on the browser). If that fails,
/// the last known page, or page 1, is used as a fallback value.
function getCurrentPdfPage() {
  try {
    const href = el.pdfFrame.contentWindow.location.href;
    const match = href.match(/[#&]page=(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch (e) {
    // Access denied (cross-origin/PDF viewer internals) — not a problem,
    // we fall back to the last known value below.
  }
  return state.lastPdfPage || 1;
}

async function compileCurrentFile() {
  if (!state.currentTexPath) {
    setStatus("Please select a .tex file first.", true);
    return;
  }

  // Remember the currently shown PDF page so we can jump back to it after
  // compiling (best effort, see getCurrentPdfPage).
  state.lastPdfPage = getCurrentPdfPage();

  // Auto-save before compiling so the preview reflects the current content.
  await saveCurrentTexFile();

  setStatus("Compiling …");
  try {
    const result = await apiPostJson("/api/compile", { path: state.currentTexPath });
    renderCompileResult(result);
  } catch (e) {
    setStatus(`Error while compiling: ${e.message}`, true);
    el.tabErrors.innerHTML = `<div class="error-item">${escapeHtml(e.message)}</div>`;
    showTab("tab-errors");
  }
}

// ---------- Error/warning markers in the editor ----------

// Line markers currently set in the editor (background color + gutter
// icon), so they can be removed before the next compile.
let issueLineMarks = [];

function clearIssueMarks() {
  if (!cm || typeof cm.removeLineClass !== "function") return;
  issueLineMarks.forEach(({ lineIndex, cls }) => {
    cm.removeLineClass(lineIndex, "background", cls);
    cm.setGutterMarker(lineIndex, "cm-issue-gutter", null);
  });
  issueLineMarks = [];
}

function markIssueLine(lineNumber1Based, type) {
  if (!cm || typeof cm.addLineClass !== "function" || !lineNumber1Based) return;
  const lineIndex = lineNumber1Based - 1;
  if (lineIndex < 0 || lineIndex > cm.lastLine()) return;

  const cls = type === "error" ? "cm-error-line" : "cm-warning-line";
  cm.addLineClass(lineIndex, "background", cls);

  const marker = document.createElement("span");
  marker.className = type === "error" ? "cm-issue-marker cm-issue-marker-error" : "cm-issue-marker cm-issue-marker-warning";
  marker.textContent = type === "error" ? "●" : "▲";
  marker.title = type === "error" ? "Error on this line" : "Warning on this line";
  cm.setGutterMarker(lineIndex, "cm-issue-gutter", marker);

  issueLineMarks.push({ lineIndex, cls });
}

function jumpToLine(lineNumber1Based) {
  if (!cm || typeof cm.setCursor !== "function" || !lineNumber1Based) return;
  const lineIndex = Math.max(0, Math.min(lineNumber1Based - 1, cm.lastLine()));
  cm.setCursor({ line: lineIndex, ch: 0 });
  cm.scrollIntoView({ line: lineIndex, ch: 0 }, 80);
  cm.focus();
}

function renderCompileResult(result) {
  // Remove previous line markers and set new ones.
  clearIssueMarks();

  // Errors / warnings
  el.tabErrors.innerHTML = "";
  if (result.errors.length === 0 && result.warnings.length === 0) {
    el.tabErrors.innerHTML = `<div class="success-item">${iconSvgHtml("icon-check")} No errors or warnings.</div>`;
  } else {
    result.errors.forEach((err) => {
      markIssueLine(err.line, "error");
      const div = document.createElement("div");
      div.className = "error-item";
      const lineLabel = err.line ? `Line ${err.line}: ` : "";
      div.innerHTML = `${iconSvgHtml("icon-error")} ${lineLabel}${escapeHtml(err.message)}`;
      if (err.line) {
        div.classList.add("issue-item-clickable");
        div.title = "Jump to this line in the editor";
        div.addEventListener("click", () => jumpToLine(err.line));
      }
      el.tabErrors.appendChild(div);
    });
    result.warnings.forEach((warn) => {
      markIssueLine(warn.line, "warning");
      const div = document.createElement("div");
      div.className = "warning-item";
      const lineLabel = warn.line ? `Line ${warn.line}: ` : "";
      div.innerHTML = `${iconSvgHtml("icon-warning")} ${lineLabel}${escapeHtml(warn.message)}`;
      if (warn.line) {
        div.classList.add("issue-item-clickable");
        div.title = "Jump to this line in the editor";
        div.addEventListener("click", () => jumpToLine(warn.line));
      }
      el.tabErrors.appendChild(div);
    });
  }

  // PDF — jumps back to the page remembered before compiling
  // (see compileCurrentFile/getCurrentPdfPage).
  if (result.success && result.pdf_path) {
    el.pdfFrame.style.display = "block";
    const page = state.lastPdfPage || 1;
    el.pdfFrame.src = `/api/pdf?path=${encodeURIComponent(result.pdf_path)}&t=${Date.now()}#page=${page}`;
    el.tabPdf.querySelector(".hint")?.remove();
    setStatus("Compilation successful.");
    showTab("tab-pdf");
  } else {
    setStatus("Compilation failed — see the \"Errors\" tab.", true);
    showTab("tab-errors");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- BibTeX sources (area 4) ----------

async function loadBibFile(path) {
  try {
    const res = await apiGet(`/api/bib?path=${encodeURIComponent(path)}`);
    const entries = await res.json();
    state.currentBibPath = path;
    state.bibEntries = entries;
    renderBibEntries(entries);
  } catch (e) {
    setStatus(`Error loading the BibTeX file: ${e.message}`, true);
  }
}

function renderBibEntries(entries) {
  el.bibList.innerHTML = "";
  if (entries.length === 0) {
    el.bibList.innerHTML = `<p class="hint">No entries found.</p>`;
    return;
  }
  entries.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "bib-entry";
    div.title = "Double-click: open link/Google Scholar · Drag into editor: insert \\cite{} · Right-click: more options";
    div.draggable = true;
    const title = entry.fields.title || "(no title)";
    const author = entry.fields.author || "";
    const year = entry.fields.year || "";
    div.innerHTML = `
      <span class="bib-key">${escapeHtml(entry.key)} <em>(${escapeHtml(entry.entry_type)})</em></span>
      <span class="bib-title">${escapeHtml(title)}</span>
      <span class="bib-meta">${escapeHtml(author)}${author && year ? " · " : ""}${escapeHtml(year)}</span>
    `;
    div.addEventListener("dblclick", () => openBibSourceLink(entry));
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", `\\cite{${entry.key}}`);
      e.dataTransfer.effectAllowed = "copy";
      div.classList.add("dragging");
    });
    div.addEventListener("dragend", () => div.classList.remove("dragging"));
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openBibContextMenu(e.clientX, e.clientY, entry);
    });
    el.bibList.appendChild(div);
  });
}

// ---------- Open link / Google Scholar on double-click ----------

/// Determines the best available source for an entry: an existing
/// url/link/doi field, otherwise a Google Scholar search for title + author.
function bibEntrySourceUrl(entry) {
  const f = entry.fields || {};
  if (f.url) return { url: f.url, isScholar: false };
  if (f.link) return { url: f.link, isScholar: false };
  if (f.doi) return { url: `https://doi.org/${f.doi.trim()}`, isScholar: false };

  const queryParts = [f.title, f.author].filter(Boolean).join(" ") || entry.key;
  return {
    url: `https://scholar.google.com/scholar?q=${encodeURIComponent(queryParts)}`,
    isScholar: true,
  };
}

function openBibSourceLink(entry) {
  const { url, isScholar } = bibEntrySourceUrl(entry);
  window.open(url, "_blank", "noopener,noreferrer");
  setStatus(isScholar ? `Google Scholar search opened for "${entry.key}".` : `Link opened: ${url}`);
}

function insertCitation(key) {
  if (!cm || !state.currentTexPath) {
    setStatus("Please open a .tex file in the editor first.", true);
    return;
  }
  cm.replaceSelection(`\\cite{${key}}`);
  cm.focus();
  state.dirty = true;
  setStatus(`\\cite{${key}} inserted.`);
}

// ---------- Context menu for citations (right-click) ----------

let bibContextMenuTarget = null;

function openBibContextMenu(x, y, entry) {
  bibContextMenuTarget = entry;
  el.bibContextMenu.style.display = "block";
  const rect = el.bibContextMenu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
  el.bibContextMenu.style.left = `${Math.max(0, clampedX)}px`;
  el.bibContextMenu.style.top = `${Math.max(0, clampedY)}px`;
}

function closeBibContextMenu() {
  el.bibContextMenu.style.display = "none";
  bibContextMenuTarget = null;
}

document.addEventListener("click", (e) => {
  if (!el.bibContextMenu.contains(e.target)) closeBibContextMenu();
});
document.addEventListener("scroll", closeBibContextMenu, true);
window.addEventListener("blur", closeBibContextMenu);

el.bibContextMenu.querySelectorAll(".context-menu-item").forEach((item) => {
  item.addEventListener("click", async () => {
    const action = item.dataset.action;
    const entry = bibContextMenuTarget;
    closeBibContextMenu();
    if (!entry) return;

    if (action === "open-link") {
      openBibSourceLink(entry);
    } else if (action === "insert-cite") {
      insertCitation(entry.key);
    } else if (action === "edit-bib") {
      openBibEditModal(entry);
    } else if (action === "delete-bib") {
      await handleDeleteBibEntry(entry);
    }
  });
});

// ---------- Edit / create citation ----------

let bibEditTarget = null;
let bibEditMode = "edit"; // "edit" | "create"
let bibCreatePath = null;

function openBibEditModal(entry) {
  bibEditMode = "edit";
  bibEditTarget = entry;
  bibCreatePath = null;
  el.bibEditTitle.textContent = `Edit entry — ${entry.key}`;
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-save")} Save`;
  el.bibEditTextarea.value = entry.raw;
  el.bibEditModal.style.display = "flex";
  el.bibEditTextarea.focus();
}

/// Opens the edit dialog in "new" mode with a template entry that gets
/// appended to the given .bib file when saved.
function openBibCreateModal(bibPath) {
  const year = new Date().getFullYear();
  bibEditMode = "create";
  bibEditTarget = null;
  bibCreatePath = bibPath;
  el.bibEditTitle.textContent = "New citation entry";
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-plus")} Create`;
  el.bibEditTextarea.value =
    `@article{key${year},\n` +
    `  author  = {},\n` +
    `  title   = {},\n` +
    `  journal = {},\n` +
    `  year    = {${year}}\n` +
    `}`;
  el.bibEditModal.style.display = "flex";
  el.bibEditTextarea.focus();
  el.bibEditTextarea.select();
}

function closeBibEditModal() {
  el.bibEditModal.style.display = "none";
  bibEditTarget = null;
  bibCreatePath = null;
  bibEditMode = "edit";
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-save")} Save`;
}

el.bibEditCancel.addEventListener("click", closeBibEditModal);
el.bibEditModal.addEventListener("click", (e) => {
  if (e.target === el.bibEditModal) closeBibEditModal();
});

el.bibEditSave.addEventListener("click", async () => {
  const newRaw = el.bibEditTextarea.value.trim();
  if (!newRaw) {
    setStatus("The entry must not be empty.", true);
    return;
  }

  if (bibEditMode === "create") {
    if (!bibCreatePath) return;
    try {
      await apiPostJson("/api/bib/entry/create", { bib_path: bibCreatePath, raw: newRaw });
      setStatus("New citation entry added.");
      const path = bibCreatePath;
      closeBibEditModal();
      await loadBibFile(path);
    } catch (e) {
      setStatus(`Error creating the entry: ${e.message}`, true);
    }
    return;
  }

  if (!bibEditTarget || !state.currentBibPath) return;
  try {
    await apiPostJson("/api/bib/entry", {
      bib_path: state.currentBibPath,
      original_key: bibEditTarget.key,
      raw: newRaw,
    });
    setStatus(`Entry "${bibEditTarget.key}" saved.`);
    closeBibEditModal();
    await loadBibFile(state.currentBibPath);
  } catch (e) {
    setStatus(`Error saving the entry: ${e.message}`, true);
  }
});

// ---------- New citation entry (button "+ New" in area 4) ----------

el.btnNewBibEntry.addEventListener("click", () => handleNewBibEntry());

async function handleNewBibEntry() {
  if (!state.workingDir) {
    setStatus("Please open a working folder first.", true);
    return;
  }

  let bibPath = state.currentBibPath;

  if (!bibPath) {
    const name = (prompt("Name of the BibTeX file:", "references.bib") || "").trim();
    if (!name) return;
    bibPath = state.workingDir.endsWith("/") ? state.workingDir + name : `${state.workingDir}/${name}`;
    try {
      // Creates the file if it doesn't exist yet. If it already exists
      // (409), the existing file is simply reused.
      const result = await apiPostJson("/api/file/create", { dir: state.workingDir, name });
      bibPath = result.path;
      await refreshTree();
    } catch (e) {
      // The file presumably already exists — continue with the computed path.
    }
    state.currentBibPath = bibPath;
  }

  openBibCreateModal(bibPath);
}

// ---------- Delete citation ----------

async function handleDeleteBibEntry(entry) {
  if (!state.currentBibPath) return;
  if (!confirm(`Really delete the entry "${entry.key}"?`)) return;
  try {
    await apiPostJson("/api/bib/entry/delete", {
      bib_path: state.currentBibPath,
      key: entry.key,
    });
    setStatus(`Entry "${entry.key}" deleted.`);
    await loadBibFile(state.currentBibPath);
  } catch (e) {
    setStatus(`Error deleting the entry: ${e.message}`, true);
  }
}

// ---------- Load / save project ----------

async function refreshProjectList() {
  try {
    const res = await apiGet("/api/project/list");
    const names = await res.json();
    el.projectSelect.innerHTML = `<option value="">– Load project –</option>`;
    names.forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      el.projectSelect.appendChild(opt);
    });
  } catch (e) {
    // Failing silently here is fine — the list is just a convenience feature.
  }
}

el.btnSaveProject.addEventListener("click", async () => {
  const name = el.projectName.value.trim();
  if (!name) {
    setStatus("Please enter a project name.", true);
    return;
  }
  if (!state.workingDir) {
    setStatus("Please open a working folder first.", true);
    return;
  }
  try {
    await apiPostJson("/api/project/save", {
      name,
      working_dir: state.workingDir,
      tex_file: state.currentTexPath,
      bib_file: state.currentBibPath,
    });
    setStatus(`Project "${name}" saved.`);
    refreshProjectList();
  } catch (e) {
    setStatus(`Error saving the project: ${e.message}`, true);
  }
});

el.btnLoadProject.addEventListener("click", async () => {
  const name = el.projectSelect.value || el.projectName.value.trim();
  if (!name) {
    setStatus("Please select a project or enter a name.", true);
    return;
  }
  try {
    const res = await apiGet(`/api/project/load?name=${encodeURIComponent(name)}`);
    const config = await res.json();
    el.projectName.value = config.name;
    await openWorkingDir(config.working_dir);
    if (config.tex_file) {
      await loadTexFile(config.tex_file);
    }
    if (config.bib_file) {
      await loadBibFile(config.bib_file);
    }
    setStatus(`Project "${config.name}" loaded.`);
  } catch (e) {
    setStatus(`Error loading the project: ${e.message}`, true);
  }
});

// ---------- Initialization ----------

refreshProjectList();
