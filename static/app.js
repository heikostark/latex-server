// ---------- Globaler Zustand ----------
const state = {
  workingDir: "",
  currentTexPath: null,
  currentBibPath: null,
  bibEntries: [],
  dirty: false,
  selectedTreePath: null, // per Einfachklick im Arbeitsordner ausgewählte Datei (z.B. für latexdiff)
  expandedPaths: new Set(), // aufgeklappte Unterordner im Arbeitsordner-Baum (Standard: alle zugeklappt)
  lastPdfPage: 1, // vor dem letzten Kompilieren angezeigte PDF-Seite (siehe compileCurrentFile)
};

// ---------- Elemente ----------
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

/// Liefert ein zum Dateityp passendes Icon; bei Ordnern abhängig vom
/// Auf-/Zuklapp-Zustand (offener/geschlossener Ordner).
/// Liefert das passende SVG-Symbol (id im Icon-Sprite) plus eine CSS-Klasse
/// zur Einfärbung nach Dateityp. Bewusst kein Emoji-Text (siehe Kommentar
/// beim Icon-Sprite in index.html) — funktioniert daher unabhängig davon,
/// ob eine Farb-Emoji-Schriftart auf dem System installiert ist.
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
    return { symbol: "icon-file", cls: "icon-build" }; // typische LaTeX-Build-Nebenprodukte
  }
  if (ext === "bak") return { symbol: "icon-file", cls: "icon-backup" };
  return { symbol: "icon-file", cls: "icon-generic" };
}

/// Baut das <svg><use></use></svg>-Markup für ein Icon aus dem Sprite.
function iconSvgHtml(symbol, extraClass) {
  const cls = extraClass ? `icon ${extraClass}` : "icon";
  return `<svg class="${cls}"><use href="#${symbol}"></use></svg>`;
}

// ---------- LaTeX-Autovervollständigung ----------

// Häufige LaTeX-Befehle. Wird nach dem letzten "\" vor dem Cursor gefiltert.
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

// Umgebungsnamen für \begin{...} / \end{...}.
const LATEX_ENVIRONMENTS = [
  "document", "itemize", "enumerate", "description",
  "figure", "table", "tabular", "tabularx", "array",
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "center", "flushleft", "flushright", "quote", "quotation", "verbatim", "verse",
  "abstract", "minipage", "thebibliography",
];

/// Eigene CodeMirror-Hint-Funktion: schlägt je nach Kontext entweder
/// LaTeX-Umgebungsnamen (nach "\begin{"/"\end{") oder LaTeX-Befehle (nach
/// dem letzten "\") vor.
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

// ---------- CodeMirror-Editor (Bereich 2) ----------

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
        dragDrop: true, // erlaubt das Ablegen von gezogenem Text (z.B. \cite{}) an der Mausposition
        extraKeys: { "Ctrl-Space": "autocomplete" },
        hintOptions: { hint: latexHint, completeSingle: false },
        // Eigenes Gutter für Fehler-/Warnungs-Symbole neben den Zeilennummern.
        gutters: ["CodeMirror-linenumbers", "cm-issue-gutter"],
        value: "",
      });
      cm.on("change", () => {
        state.dirty = true;
      });
      // Automatisches Vorschlagen von LaTeX-Befehlen/Umgebungen während des
      // Tippens (zusätzlich zu Strg+Leertaste für manuelles Aufrufen).
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
      console.error("CodeMirror-Initialisierung fehlgeschlagen, verwende einfachen Texteditor:", e);
    }
  }

  // Ausweich-Editor: eine einfache <textarea>, falls CodeMirror aus
  // irgendeinem Grund nicht verfügbar ist (z.B. eine fehlende lokale
  // Vendor-Datei). Bietet dieselbe kleine API (getValue/setValue/on/
  // replaceSelection/focus/clearHistory/refresh), damit der restliche
  // Code unverändert funktioniert — nur ohne Syntaxhervorhebung.
  setStatus("Hinweis: Editor-Bibliothek konnte nicht geladen werden — einfacher Texteditor wird verwendet.", true);
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
    // Bestmögliche Annäherung an Undo/Redo ohne CodeMirror: nutzt den
    // nativen Undo-Stack des Browsers für Textfelder. Nicht in jedem
    // Browser garantiert, aber breit unterstützt.
    undo: () => {
      textarea.focus();
      try {
        document.execCommand("undo");
      } catch (e) {
        /* execCommand nicht verfügbar — keine Aktion möglich */
      }
    },
    redo: () => {
      textarea.focus();
      try {
        document.execCommand("redo");
      } catch (e) {
        /* execCommand nicht verfügbar — keine Aktion möglich */
      }
    },
    // Keine echte Cursor-basierte Suche im Ausweich-Editor verfügbar;
    // getSearchCursor bleibt bewusst undefiniert, damit die Suchfunktionen
    // erkennen können, dass sie im Fallback-Modus nicht arbeiten können.
  };
  return cm;
}

// Visuelles Feedback, während ein Zitat über den Editor gezogen wird.
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

// ---------- Suchen & Ersetzen (Editor-Fußleiste) ----------

function searchSupported() {
  return !!cm && typeof cm.getSearchCursor === "function";
}

// Alle aktuell markierten Treffer (CodeMirror TextMarker), damit sie vor
// einer Neuberechnung entfernt werden können.
let searchMarkers = [];

function clearSearchMarkers() {
  searchMarkers.forEach((m) => m.clear());
  searchMarkers = [];
}

/// Markiert JEDEN Treffer des aktuellen Suchbegriffs im Editor (nicht nur
/// den aktuell selektierten) und aktualisiert die Trefferanzahl. Wird bei
/// jeder Änderung des Suchfelds sowie nach Ersetzungen neu aufgerufen, da
/// sich die Trefferpositionen dabei ändern können.
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
  el.searchMatchCount.textContent = count > 0 ? `${count} Treffer` : "Keine Treffer";
}

function performFind(direction = 1) {
  if (!cm) {
    setStatus("Bitte zuerst eine Datei im Editor öffnen.", true);
    return;
  }
  if (!searchSupported()) {
    setStatus("Suche ist im einfachen Ausweich-Editor nicht verfügbar.", true);
    return;
  }
  const query = el.searchInput.value;
  if (!query) return;

  const startPos = direction > 0 ? cm.getCursor("to") : cm.getCursor("from");
  let cursor = cm.getSearchCursor(query, startPos, { caseFold: true });
  let found = direction > 0 ? cursor.findNext() : cursor.findPrevious();

  if (!found) {
    // Kein weiterer Treffer in dieser Richtung — von vorne/hinten umlaufen.
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
    setStatus(`Kein Treffer für „${query}“.`, true);
  }
}

function replaceCurrent() {
  if (!searchSupported()) {
    setStatus("Ersetzen ist im einfachen Ausweich-Editor nicht verfügbar.", true);
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
    setStatus("Ersetzen ist im einfachen Ausweich-Editor nicht verfügbar.", true);
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
  setStatus(count > 0 ? `${count} Ersetzung(en) durchgeführt.` : `Kein Treffer für „${query}“.`, count === 0);
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

// ---------- Rückgängig / Wiederholen (Editor-Fußleiste) ----------

el.btnUndo.addEventListener("click", () => {
  if (!cm) {
    setStatus("Bitte zuerst eine Datei im Editor öffnen.", true);
    return;
  }
  if (typeof cm.undo === "function") cm.undo();
});

el.btnRedo.addEventListener("click", () => {
  if (!cm) {
    setStatus("Bitte zuerst eine Datei im Editor öffnen.", true);
    return;
  }
  if (typeof cm.redo === "function") cm.redo();
});

// ---------- Hilfsfunktionen ----------

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

// ---------- Arbeitsordner / Dateibaum (Bereich 1) ----------

el.btnOpenFolder.addEventListener("click", async () => {
  const dir = el.workingDirInput.value.trim();
  if (!dir) {
    setStatus("Bitte einen Ordnerpfad angeben.", true);
    return;
  }
  await openWorkingDir(dir);
});

// ---------- Ordnerauswahl-Dialog ----------

let modalCurrentDir = null;

el.btnBrowseFolder.addEventListener("click", () => {
  openFolderModal(el.workingDirInput.value.trim() || state.workingDir || null);
});

el.modalCancel.addEventListener("click", closeFolderModal);
el.folderModal.addEventListener("click", (e) => {
  if (e.target === el.folderModal) closeFolderModal(); // Klick auf Hintergrund
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
      // Eine Ebene höher navigieren: mit dem Elternordner neu laden.
      await browseModalTo(data.parent, false);
      return;
    }

    modalCurrentDir = data.current;
    el.modalCurrentPath.value = data.current;
    el.modalUp.disabled = !data.parent;
    renderModalDirs(data.dirs);
  } catch (e) {
    setStatus(`Fehler beim Durchsuchen: ${e.message}`, true);
  }
}

function renderModalDirs(dirs) {
  el.modalDirList.innerHTML = "";
  if (dirs.length === 0) {
    el.modalDirList.innerHTML = `<p class="hint">Keine Unterordner vorhanden.</p>`;
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
    state.expandedPaths = new Set(); // neuer Ordner: alle Unterordner wieder zugeklappt
    el.workingDirInput.value = dir;
    renderTree(tree);
    setStatus(`Ordner geöffnet: ${dir}`);
    await autoLoadBibFile(tree);
    startWatchingWorkingDir(dir);
  } catch (e) {
    setStatus(`Fehler beim Öffnen des Ordners: ${e.message}`, true);
  }
}

// ---------- Dateisystem-Überwachung (automatische Synchronisation) ----------

// Server-Sent-Events-Verbindung, die den Ordnerbaum automatisch aktuell
// hält, sobald sich außerhalb der App etwas im Arbeitsordner ändert
// (Dateien angelegt/geändert/gelöscht — auch in Unterordnern).
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
      // Verbindung verloren (z.B. Server kurz neu gestartet) — der Browser
      // versucht bei EventSource automatisch, sich erneut zu verbinden.
    };
  } catch (e) {
    console.error("Dateisystem-Überwachung konnte nicht gestartet werden:", e);
  }
}

function renderTree(node) {
  el.fileTree.innerHTML = "";
  const rootUl = document.createElement("ul");
  rootUl.appendChild(renderNode(node, true));
  el.fileTree.appendChild(rootUl);
}

// Verzögert das eigentliche Setzen von state.selectedTreePath kurz, damit
// bei einem Doppelklick (der zunächst zwei normale "click"-Events auslöst,
// bevor "dblclick" feuert) das Öffnen einer Datei im Editor nicht
// versehentlich die zuvor bewusst getroffene Tree-Auswahl überschreibt.
// Jeder Baumknoten bekommt dafür seinen eigenen Timer (siehe renderNode).

function renderNode(node, isRoot = false) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = "tree-item" + (node.is_dir ? " dir" : "");
  span.dataset.path = node.path;
  span.dataset.isDir = node.is_dir ? "1" : "0";
  span.dataset.name = node.name;
  // Für Dateien: Verzeichnis, in dem sie liegen (für "Neue Datei hier" im Kontextmenü).
  span.dataset.parentDir = node.is_dir ? node.path : state.workingDir;

  const hasChildren = node.is_dir && node.children && node.children.length > 0;
  // Der Arbeitsordner (Wurzel) ist immer aufgeklappt; alle Unterordner
  // merken sich ihren Zustand in state.expandedPaths (Standard: zugeklappt).
  const isExpanded = isRoot || state.expandedPaths.has(node.path);

  // Auf-/Zuklapp-Pfeil (nur für Ordner mit Inhalt); bei Dateien und leeren
  // Ordnern bleibt er als unsichtbarer Platzhalter stehen, damit alle
  // Beschriftungen auf gleicher Höhe beginnen.
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

  // Eigener, pro Knoten unabhängiger Timer für die verzögerte Auswahl
  // (siehe Kommentar oben) — wichtig: NICHT global/geteilt, sonst würde
  // ein Doppelklick auf Datei B den noch ausstehenden Auswahl-Timer von
  // Datei A abbrechen.
  let selectTimer = null;

  if (!node.is_dir) {
    span.title = fileInteractionHint(node.name);

    // Einfacher Klick markiert die Datei visuell sofort; das Setzen von
    // state.selectedTreePath wird kurz verzögert und bei einem
    // nachfolgenden Doppelklick auf DIESER Datei verworfen (siehe dblclick
    // unten). Ein Doppelklick auf eine ANDERE Datei berührt diesen Timer
    // nicht, da er pro Knoten unabhängig ist.
    span.addEventListener("click", () => {
      document.querySelectorAll(".tree-item.selected").forEach((e) => e.classList.remove("selected"));
      span.classList.add("selected");
      if (selectTimer) clearTimeout(selectTimer);
      selectTimer = setTimeout(() => {
        state.selectedTreePath = node.path;
        selectTimer = null;
      }, 280);
    });

    // Doppelklick ist die einheitliche "Öffnen"-Aktion, je nach Dateityp:
    // .tex/.txt → Editor · .bib → Zitateansicht · Bilder/Tabellen → Vorschau.
    // Die noch ausstehende Auswahl-Aktualisierung dieser Datei (siehe click
    // oben) wird dabei verworfen, damit "Öffnen" nicht gleichzeitig die für
    // latexdiff gemerkte Vergleichsdatei auf sich selbst verändert.
    span.addEventListener("dblclick", () => {
      if (selectTimer) {
        clearTimeout(selectTimer);
        selectTimer = null;
      }
      handleFileOpen(node);
    });

    // Bilder und Tabellen lassen sich zusätzlich in den Editor ziehen.
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
      isRoot: isRoot, // Der Arbeitsordner selbst darf nicht umbenannt/gelöscht werden.
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

  // Klick auf einen Ordner mit Inhalt klappt ihn auf/zu (der Wurzelordner
  // selbst bleibt davon ausgenommen und ist immer aufgeklappt).
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
    setStatus(`PDF geöffnet: ${node.name}`);
  } else {
    setStatus(`Für „${node.name}“ ist kein Öffnen/Vorschau definiert.`, true);
  }
}

function fileInteractionHint(name) {
  if (isTexOrTextFile(name)) return "Doppelklick: im Editor öffnen · Rechtsklick: weitere Optionen";
  if (fileExtension(name) === "bib") return "Doppelklick: Zitate anzeigen · Rechtsklick: weitere Optionen";
  if (isImageFile(name)) {
    return "Doppelklick: Vorschau öffnen · Ziehen in den Editor: \\figure einfügen · Rechtsklick: weitere Optionen";
  }
  if (isTableFile(name)) {
    return "Doppelklick: Vorschau öffnen · Ziehen in den Editor: \\table einfügen · Rechtsklick: weitere Optionen";
  }
  if (fileExtension(name) === "pdf") return "Doppelklick: PDF öffnen · Rechtsklick: weitere Optionen";
  return "Rechtsklick: weitere Optionen";
}

// ---------- Ziehen von Bildern/Tabellen in den Editor ----------

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

/// Verzeichnis, relativ zu dem eingefügte Pfade (\includegraphics etc.)
/// aufgelöst werden: das Verzeichnis der aktuell geöffneten .tex-Datei,
/// sonst ersatzweise der Arbeitsordner.
function referenceDir() {
  if (state.currentTexPath) {
    const idx = state.currentTexPath.lastIndexOf("/");
    return idx === -1 ? state.currentTexPath : state.currentTexPath.slice(0, idx);
  }
  return state.workingDir;
}

/// Berechnet den relativen Pfad von einem Verzeichnis zu einer Zieldatei
/// (beide als absolute, mit "/" getrennte Pfade).
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

/// Erzeugt aus einem Dateinamen einen für \label{} geeigneten Bezeichner.
function sanitizeLabel(name) {
  const base = name.replace(/\.[^./]+$/, "");
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "datei";
}

function buildFigureSnippet(imagePath) {
  const rel = relativePath(referenceDir(), imagePath);
  const label = sanitizeLabel(imagePath.split("/").pop());
  return (
    `\\begin{figure}[htbp]\n` +
    `    \\centering\n` +
    `    \\includegraphics[width=0.8\\textwidth]{${rel}}\n` +
    `    \\caption{TODO: Beschreibung}\n` +
    `    \\label{fig:${label}}\n` +
    `\\end{figure}\n`
  );
}

/// Escapt LaTeX-Sonderzeichen in Zellwerten, damit die eingefügte Tabelle
/// kompilierbar bleibt.
function escapeLatex(value) {
  return String(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/// Synchrones GET (blockiert kurz, wird bewusst nur beim Drag-Start einer
/// Tabellendatei verwendet, damit die Zellwerte noch innerhalb desselben
/// dragstart-Events in dataTransfer geschrieben werden können — ein
/// asynchroner fetch käme dafür zu spät).
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
      /* Antwort war kein JSON — Statustext beibehalten. */
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
    setStatus(`Fehler beim Lesen der Tabelle „${name}“: ${e.message}`, true);
    return `% Fehler beim Einlesen von ${name}: ${e.message}\n`;
  }

  const headers = data.headers;
  const usedRows = data.rows.slice(0, MAX_TABLE_INSERT_ROWS);
  const colSpec = headers.map(() => "l").join("") || "l";
  const label = sanitizeLabel(name);

  const headerLine = headers.map(escapeLatex).join(" & ") + " \\\\";
  const bodyLines = usedRows.map((row) => row.map(escapeLatex).join(" & ") + " \\\\").join("\n        ");
  const truncNote =
    data.total_rows > usedRows.length
      ? `    % Hinweis: nur die ersten ${usedRows.length} von ${data.total_rows} Zeilen wurden eingefügt.\n`
      : "";

  setStatus(`Tabelle „${name}“ eingefügt (${usedRows.length} von ${data.total_rows} Zeilen).`);

  return (
    `% Erfordert \\usepackage{booktabs} in der Präambel\n` +
    `\\begin{table}[htbp]\n` +
    `    \\centering\n` +
    `    \\caption{TODO: Beschreibung}\n` +
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

// ---------- Tabellenvorschau (Doppelklick) ----------

async function openTablePreview(node) {
  setStatus(`Lade Tabelle „${node.name}“ …`);
  try {
    const res = await apiGet(`/api/table?path=${encodeURIComponent(node.path)}`);
    const data = await res.json();
    renderTablePreview(node.name, data);
  } catch (e) {
    setStatus(`Fehler beim Laden der Tabelle: ${e.message}`, true);
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
    note.textContent = `Hinweis: Anzeige begrenzt auf die ersten ${data.rows.length} von ${data.total_rows} Zeilen.`;
    el.tableModalBody.appendChild(note);
  }

  el.tableModal.style.display = "flex";
  setStatus(`Tabelle geladen: ${name}`);
}

function closeTableModal() {
  el.tableModal.style.display = "none";
  el.tableModalBody.innerHTML = "";
}

el.tableModalClose.addEventListener("click", closeTableModal);
el.tableModal.addEventListener("click", (e) => {
  if (e.target === el.tableModal) closeTableModal();
});

// ---------- Baum aktualisieren ----------

async function refreshTree() {
  if (!state.workingDir) return;
  try {
    const res = await apiGet(`/api/tree?dir=${encodeURIComponent(state.workingDir)}`);
    const tree = await res.json();
    renderTree(tree);
  } catch (e) {
    setStatus(`Fehler beim Aktualisieren des Baums: ${e.message}`, true);
  }
}

// ---------- Bildvorschau (Doppelklick) ----------

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

// ---------- Kontextmenü (Rechtsklick: Neu / Umbenennen / Löschen) ----------

let contextMenuTarget = null;

// Rechtsklick auf freie Fläche im Dateibaum (nicht auf ein Element) → nur "Neue Datei hier".
el.fileTree.addEventListener("contextmenu", (e) => {
  if (e.target.closest(".tree-item")) return; // wird vom Element selbst behandelt
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
  // Position im sichtbaren Bereich halten.
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

// ---------- Neue .tex-Datei erstellen (aus dem Kontextmenü, siehe openContextMenu) ----------

async function handleNewFile(dir) {
  if (!dir) {
    setStatus("Bitte zuerst einen Arbeitsordner öffnen.", true);
    return;
  }
  const name = prompt("Name der neuen .tex-Datei:", "neue-datei.tex");
  if (!name) return;
  try {
    const result = await apiPostJson("/api/file/create", { dir, name });
    setStatus(`Datei erstellt: ${result.path}`);
    await refreshTree();
    await loadTexFile(result.path);
  } catch (e) {
    setStatus(`Fehler beim Erstellen der Datei: ${e.message}`, true);
  }
}

// ---------- Neuen Ordner erstellen (aus dem Kontextmenü, siehe openContextMenu) ----------

async function handleNewFolder(dir) {
  if (!dir) {
    setStatus("Bitte zuerst einen Arbeitsordner öffnen.", true);
    return;
  }
  const name = prompt("Name des neuen Ordners:", "neuer-ordner");
  if (!name) return;
  try {
    const result = await apiPostJson("/api/folder/create", { dir, name });
    setStatus(`Ordner erstellt: ${result.path}`);
    // Neu angelegten Ordner direkt aufgeklappt anzeigen (ist leer, aber
    // so sieht man sofort, dass er da ist, ohne extra klicken zu müssen).
    state.expandedPaths.add(result.path);
    await refreshTree();
  } catch (e) {
    setStatus(`Fehler beim Erstellen des Ordners: ${e.message}`, true);
  }
}

// ---------- Diff erstellen (latexdiff) ----------

el.btnLatexDiff.addEventListener("click", () => handleLatexDiff());

async function handleLatexDiff() {
  if (!state.selectedTreePath) {
    setStatus("Bitte zuerst eine Datei im Arbeitsordner auswählen (Einfachklick).", true);
    return;
  }
  if (!state.currentTexPath) {
    setStatus("Bitte zuerst eine Datei im Editor öffnen.", true);
    return;
  }
  if (state.selectedTreePath === state.currentTexPath) {
    setStatus("Bitte im Arbeitsordner eine andere Datei als die im Editor geöffnete auswählen.", true);
    return;
  }

  // latexdiff liest von der Festplatte — daher wird der aktuelle
  // Editor-Inhalt vorher gespeichert, damit der Diff dem entspricht, was
  // im Editor zu sehen ist (analog zum Kompilieren).
  await saveCurrentTexFile();

  setStatus("Erzeuge Diff …");
  try {
    const result = await apiPostJson("/api/latexdiff", {
      old_path: state.selectedTreePath,
      new_path: state.currentTexPath,
    });
    if (result.success && result.diff_path) {
      setStatus(`Diff erstellt: ${result.diff_path.split("/").pop()}`);
      await refreshTree();
      await loadTexFile(result.diff_path);
    } else {
      setStatus(`Diff fehlgeschlagen: ${result.log || "Unbekannter Fehler"}`, true);
    }
  } catch (e) {
    setStatus(`Fehler beim Erzeugen des Diffs: ${e.message}`, true);
  }
}

// ---------- Umbenennen ----------

async function handleRename(target) {
  const newName = prompt("Neuer Name:", target.name);
  if (!newName || newName === target.name) return;
  try {
    const result = await apiPostJson("/api/file/rename", { path: target.path, new_name: newName });
    setStatus(`Umbenannt in: ${newName}`);
    if (state.currentTexPath === target.path) state.currentTexPath = result.path;
    if (state.currentBibPath === target.path) state.currentBibPath = result.path;
    await refreshTree();
  } catch (e) {
    setStatus(`Fehler beim Umbenennen: ${e.message}`, true);
  }
}

// ---------- Löschen ----------

async function handleDelete(target) {
  const label = target.isDir ? "den Ordner (inkl. Inhalt)" : "die Datei";
  if (!confirm(`Soll ${label} „${target.name}“ wirklich gelöscht werden?`)) return;
  try {
    await apiPostJson("/api/file/delete", { path: target.path });
    setStatus(`Gelöscht: ${target.name}`);

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
    setStatus(`Fehler beim Löschen: ${e.message}`, true);
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

// ---------- LaTeX-Editor (Bereich 2) ----------

async function loadTexFile(path) {
  let content;
  try {
    const res = await apiGet(`/api/file?path=${encodeURIComponent(path)}`);
    content = await res.text();
  } catch (e) {
    setStatus(`Fehler beim Laden der Datei: ${e.message}`, true);
    return;
  }

  // Der Zustand wird gesetzt, sobald der Dateiinhalt da ist — unabhängig
  // davon, ob die (rein visuelle) Editor-Anzeige danach erfolgreich
  // aufgebaut werden kann. So funktionieren Speichern/Kompilieren auch
  // dann zuverlässig, wenn die Editor-Bibliothek aus irgendeinem Grund
  // nicht geladen werden konnte.
  state.currentTexPath = path;
  state.dirty = false;
  el.editorTitle.textContent = "Editor — " + path.split("/").pop();

  try {
    const editor = initEditor();
    editor.setValue(content);
    editor.clearHistory();
    setTimeout(() => editor.refresh(), 0);
    // Suchzustand und Fehler-/Warnungsmarkierungen zurücksetzen: sie
    // bezogen sich auf die vorherige Datei und sind jetzt bedeutungslos.
    clearSearchMarkers();
    clearIssueMarks();
    el.searchMatchCount.textContent = "";
    setStatus(`Datei geladen: ${path}`);
  } catch (e) {
    setStatus(`Datei geladen, aber Editor-Anzeige fehlgeschlagen: ${e.message}`, true);
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
    if (!isAutoSave) setStatus("Keine Datei zum Speichern ausgewählt.", true);
    return;
  }
  try {
    await apiPostJson("/api/file", { path: state.currentTexPath, content: cm.getValue() });
    state.dirty = false;
    setStatus(isAutoSave ? "Automatisch gespeichert." : "Datei gespeichert.");
  } catch (e) {
    setStatus(`${isAutoSave ? "Automatisches Speichern" : "Speichern"} fehlgeschlagen: ${e.message}`, true);
  }
}

// ---------- Automatisches Speichern (alle 5 Minuten) ----------

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  // Nur speichern, wenn eine Datei offen ist und tatsächlich ungesicherte
  // Änderungen vorliegen — vermeidet unnötige Schreibvorgänge/Backups.
  if (state.currentTexPath && state.dirty && cm) {
    saveCurrentTexFile(true);
  }
}, AUTOSAVE_INTERVAL_MS);

// ---------- Kompilieren (Bereich 3) ----------

el.btnCompile.addEventListener("click", () => compileCurrentFile());

/// Versucht, die aktuell im PDF-Betrachter angezeigte Seite auszulesen
/// (funktioniert nur, wenn der eingebettete Browser-PDF-Viewer die Seite
/// im URL-Fragment "#page=N" widerspiegelt — je nach Browser nicht
/// garantiert). Gelingt das nicht, wird die zuletzt bekannte bzw. Seite 1
/// als Ersatzwert verwendet.
function getCurrentPdfPage() {
  try {
    const href = el.pdfFrame.contentWindow.location.href;
    const match = href.match(/[#&]page=(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch (e) {
    // Zugriff verweigert (Cross-Origin/PDF-Viewer-Interna) — kein Problem,
    // wir fallen unten auf den zuletzt bekannten Wert zurück.
  }
  return state.lastPdfPage || 1;
}

async function compileCurrentFile() {
  if (!state.currentTexPath) {
    setStatus("Bitte zuerst eine .tex-Datei auswählen.", true);
    return;
  }

  // Aktuell angezeigte PDF-Seite merken, um nach dem Kompilieren dorthin
  // zurückzuspringen (Best-Effort, siehe getCurrentPdfPage).
  state.lastPdfPage = getCurrentPdfPage();

  // Vor dem Kompilieren automatisch speichern, damit die Vorschau aktuell ist.
  await saveCurrentTexFile();

  setStatus("Kompiliere …");
  try {
    const result = await apiPostJson("/api/compile", { path: state.currentTexPath });
    renderCompileResult(result);
  } catch (e) {
    setStatus(`Fehler beim Kompilieren: ${e.message}`, true);
    el.tabErrors.innerHTML = `<div class="error-item">${escapeHtml(e.message)}</div>`;
    showTab("tab-errors");
  }
}

// ---------- Fehler-/Warnungs-Markierungen im Editor ----------

// Aktuell im Editor gesetzte Zeilenmarkierungen (Hintergrundfarbe + Gutter-
// Symbol), damit sie vor einem erneuten Kompilieren entfernt werden können.
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
  marker.title = type === "error" ? "Fehler in dieser Zeile" : "Warnung in dieser Zeile";
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
  // Vorherige Zeilenmarkierungen entfernen und neu setzen.
  clearIssueMarks();

  // Fehler / Warnungen
  el.tabErrors.innerHTML = "";
  if (result.errors.length === 0 && result.warnings.length === 0) {
    el.tabErrors.innerHTML = `<div class="success-item">${iconSvgHtml("icon-check")} Keine Fehler oder Warnungen.</div>`;
  } else {
    result.errors.forEach((err) => {
      markIssueLine(err.line, "error");
      const div = document.createElement("div");
      div.className = "error-item";
      const lineLabel = err.line ? `Zeile ${err.line}: ` : "";
      div.innerHTML = `${iconSvgHtml("icon-error")} ${lineLabel}${escapeHtml(err.message)}`;
      if (err.line) {
        div.classList.add("issue-item-clickable");
        div.title = "Zu dieser Zeile im Editor springen";
        div.addEventListener("click", () => jumpToLine(err.line));
      }
      el.tabErrors.appendChild(div);
    });
    result.warnings.forEach((warn) => {
      markIssueLine(warn.line, "warning");
      const div = document.createElement("div");
      div.className = "warning-item";
      const lineLabel = warn.line ? `Zeile ${warn.line}: ` : "";
      div.innerHTML = `${iconSvgHtml("icon-warning")} ${lineLabel}${escapeHtml(warn.message)}`;
      if (warn.line) {
        div.classList.add("issue-item-clickable");
        div.title = "Zu dieser Zeile im Editor springen";
        div.addEventListener("click", () => jumpToLine(warn.line));
      }
      el.tabErrors.appendChild(div);
    });
  }

  // PDF — springt auf die vor dem Kompilieren gemerkte Seite zurück
  // (siehe compileCurrentFile/getCurrentPdfPage).
  if (result.success && result.pdf_path) {
    el.pdfFrame.style.display = "block";
    const page = state.lastPdfPage || 1;
    el.pdfFrame.src = `/api/pdf?path=${encodeURIComponent(result.pdf_path)}&t=${Date.now()}#page=${page}`;
    el.tabPdf.querySelector(".hint")?.remove();
    setStatus("Kompilierung erfolgreich.");
    showTab("tab-pdf");
  } else {
    setStatus("Kompilierung fehlgeschlagen — siehe Reiter „Fehler“.", true);
    showTab("tab-errors");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- BibTeX-Quellen (Bereich 4) ----------

async function loadBibFile(path) {
  try {
    const res = await apiGet(`/api/bib?path=${encodeURIComponent(path)}`);
    const entries = await res.json();
    state.currentBibPath = path;
    state.bibEntries = entries;
    renderBibEntries(entries);
  } catch (e) {
    setStatus(`Fehler beim Laden der BibTeX-Datei: ${e.message}`, true);
  }
}

function renderBibEntries(entries) {
  el.bibList.innerHTML = "";
  if (entries.length === 0) {
    el.bibList.innerHTML = `<p class="hint">Keine Einträge gefunden.</p>`;
    return;
  }
  entries.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "bib-entry";
    div.title = "Doppelklick: Link/Google Scholar öffnen · Ziehen in den Editor: \\cite{} einfügen · Rechtsklick: weitere Optionen";
    div.draggable = true;
    const title = entry.fields.title || "(ohne Titel)";
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

// ---------- Link / Google Scholar per Doppelklick öffnen ----------

/// Ermittelt die beste verfügbare Quelle für einen Eintrag: ein vorhandenes
/// url-/link-/doi-Feld, sonst eine Google-Scholar-Suche nach Titel + Autor.
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
  setStatus(isScholar ? `Google-Scholar-Suche geöffnet für „${entry.key}“.` : `Link geöffnet: ${url}`);
}

function insertCitation(key) {
  if (!cm || !state.currentTexPath) {
    setStatus("Bitte zuerst eine .tex-Datei im Editor öffnen.", true);
    return;
  }
  cm.replaceSelection(`\\cite{${key}}`);
  cm.focus();
  state.dirty = true;
  setStatus(`\\cite{${key}} eingefügt.`);
}

// ---------- Kontextmenü für Zitate (Rechtsklick) ----------

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

// ---------- Zitat bearbeiten / neu anlegen ----------

let bibEditTarget = null;
let bibEditMode = "edit"; // "edit" | "create"
let bibCreatePath = null;

function openBibEditModal(entry) {
  bibEditMode = "edit";
  bibEditTarget = entry;
  bibCreatePath = null;
  el.bibEditTitle.textContent = `Eintrag bearbeiten — ${entry.key}`;
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-save")} Speichern`;
  el.bibEditTextarea.value = entry.raw;
  el.bibEditModal.style.display = "flex";
  el.bibEditTextarea.focus();
}

/// Öffnet den Bearbeiten-Dialog im "Neu"-Modus mit einem Vorlagen-Eintrag,
/// der beim Speichern an die angegebene .bib-Datei angehängt wird.
function openBibCreateModal(bibPath) {
  const year = new Date().getFullYear();
  bibEditMode = "create";
  bibEditTarget = null;
  bibCreatePath = bibPath;
  el.bibEditTitle.textContent = "Neuer Zitat-Eintrag";
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-plus")} Erstellen`;
  el.bibEditTextarea.value =
    `@article{schluessel${year},\n` +
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
  el.bibEditSave.innerHTML = `${iconSvgHtml("icon-save")} Speichern`;
}

el.bibEditCancel.addEventListener("click", closeBibEditModal);
el.bibEditModal.addEventListener("click", (e) => {
  if (e.target === el.bibEditModal) closeBibEditModal();
});

el.bibEditSave.addEventListener("click", async () => {
  const newRaw = el.bibEditTextarea.value.trim();
  if (!newRaw) {
    setStatus("Der Eintrag darf nicht leer sein.", true);
    return;
  }

  if (bibEditMode === "create") {
    if (!bibCreatePath) return;
    try {
      await apiPostJson("/api/bib/entry/create", { bib_path: bibCreatePath, raw: newRaw });
      setStatus("Neuer Zitat-Eintrag hinzugefügt.");
      const path = bibCreatePath;
      closeBibEditModal();
      await loadBibFile(path);
    } catch (e) {
      setStatus(`Fehler beim Erstellen des Eintrags: ${e.message}`, true);
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
    setStatus(`Eintrag „${bibEditTarget.key}“ gespeichert.`);
    closeBibEditModal();
    await loadBibFile(state.currentBibPath);
  } catch (e) {
    setStatus(`Fehler beim Speichern des Eintrags: ${e.message}`, true);
  }
});

// ---------- Neuer Zitat-Eintrag (Button "＋ Neu" in Bereich 4) ----------

el.btnNewBibEntry.addEventListener("click", () => handleNewBibEntry());

async function handleNewBibEntry() {
  if (!state.workingDir) {
    setStatus("Bitte zuerst einen Arbeitsordner öffnen.", true);
    return;
  }

  let bibPath = state.currentBibPath;

  if (!bibPath) {
    const name = (prompt("Name der BibTeX-Datei:", "referenzen.bib") || "").trim();
    if (!name) return;
    bibPath = state.workingDir.endsWith("/") ? state.workingDir + name : `${state.workingDir}/${name}`;
    try {
      // Legt die Datei an, falls sie noch nicht existiert. Existiert sie
      // bereits (409), wird einfach die vorhandene Datei weiterverwendet.
      const result = await apiPostJson("/api/file/create", { dir: state.workingDir, name });
      bibPath = result.path;
      await refreshTree();
    } catch (e) {
      // Vermutlich existiert die Datei schon — mit dem berechneten Pfad weiterarbeiten.
    }
    state.currentBibPath = bibPath;
  }

  openBibCreateModal(bibPath);
}

// ---------- Zitat löschen ----------

async function handleDeleteBibEntry(entry) {
  if (!state.currentBibPath) return;
  if (!confirm(`Soll der Eintrag „${entry.key}“ wirklich gelöscht werden?`)) return;
  try {
    await apiPostJson("/api/bib/entry/delete", {
      bib_path: state.currentBibPath,
      key: entry.key,
    });
    setStatus(`Eintrag „${entry.key}“ gelöscht.`);
    await loadBibFile(state.currentBibPath);
  } catch (e) {
    setStatus(`Fehler beim Löschen des Eintrags: ${e.message}`, true);
  }
}

// ---------- Projekt laden / speichern ----------

async function refreshProjectList() {
  try {
    const res = await apiGet("/api/project/list");
    const names = await res.json();
    el.projectSelect.innerHTML = `<option value="">– Projekt laden –</option>`;
    names.forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      el.projectSelect.appendChild(opt);
    });
  } catch (e) {
    // Stilles Fehlschlagen ist hier ok — die Liste ist nur eine Komfortfunktion.
  }
}

el.btnSaveProject.addEventListener("click", async () => {
  const name = el.projectName.value.trim();
  if (!name) {
    setStatus("Bitte einen Projektnamen angeben.", true);
    return;
  }
  if (!state.workingDir) {
    setStatus("Bitte zuerst einen Arbeitsordner öffnen.", true);
    return;
  }
  try {
    await apiPostJson("/api/project/save", {
      name,
      working_dir: state.workingDir,
      tex_file: state.currentTexPath,
      bib_file: state.currentBibPath,
    });
    setStatus(`Projekt "${name}" gespeichert.`);
    refreshProjectList();
  } catch (e) {
    setStatus(`Fehler beim Speichern des Projekts: ${e.message}`, true);
  }
});

el.btnLoadProject.addEventListener("click", async () => {
  const name = el.projectSelect.value || el.projectName.value.trim();
  if (!name) {
    setStatus("Bitte ein Projekt auswählen oder Namen eingeben.", true);
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
    setStatus(`Projekt "${config.name}" geladen.`);
  } catch (e) {
    setStatus(`Fehler beim Laden des Projekts: ${e.message}`, true);
  }
});

// ---------- Initialisierung ----------

refreshProjectList();
