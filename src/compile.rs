use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A single error or warning extracted from the compile log, with a
/// best-effort 1-based source line number (matching the .tex file), so the
/// frontend can highlight the corresponding editor line. `line` is `None`
/// when no line reference could be determined (e.g. some bibtex warnings).
#[derive(Serialize, Clone)]
pub struct CompileIssue {
    pub line: Option<usize>,
    pub message: String,
}

pub struct CompileOutcome {
    pub success: bool,
    pub errors: Vec<CompileIssue>,
    pub warnings: Vec<CompileIssue>,
    pub log: String,
    pub pdf_path: Option<PathBuf>,
}

/// Runs the full compile pipeline for a .tex file:
/// pdflatex -> (bibtex, if a bibliography is used) -> pdflatex x2.
/// This is a blocking function; call it via `spawn_blocking`.
pub fn run_compile(tex_path: &Path) -> Result<CompileOutcome, crate::AppError> {
    let dir = tex_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let file_stem = tex_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document")
        .to_string();
    let file_name = tex_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.tex")
        .to_string();

    let mut full_log = String::new();

    // First pdflatex pass.
    let (ok1, log1) = run_pdflatex(&dir, &file_name)?;
    full_log.push_str("--- pdflatex (Durchlauf 1) ---\n");
    full_log.push_str(&log1);

    // If the aux file references a bibliography, run bibtex and two more passes.
    let aux_path = dir.join(format!("{file_stem}.aux"));
    let needs_bibtex = std::fs::read_to_string(&aux_path)
        .map(|aux| aux.contains("\\bibdata"))
        .unwrap_or(false);

    if needs_bibtex {
        let (_ok_bib, log_bib) = run_bibtex(&dir, &file_stem)?;
        full_log.push_str("\n--- bibtex ---\n");
        full_log.push_str(&log_bib);

        let (_ok2, log2) = run_pdflatex(&dir, &file_name)?;
        full_log.push_str("\n--- pdflatex (Durchlauf 2) ---\n");
        full_log.push_str(&log2);

        let (ok3, log3) = run_pdflatex(&dir, &file_name)?;
        full_log.push_str("\n--- pdflatex (Durchlauf 3) ---\n");
        full_log.push_str(&log3);

        let pdf_path = dir.join(format!("{file_stem}.pdf"));
        let success = ok3 && pdf_path.is_file();
        let (errors, warnings) = parse_log(&full_log);
        return Ok(CompileOutcome {
            success,
            errors,
            warnings,
            log: full_log,
            pdf_path: if pdf_path.is_file() { Some(pdf_path) } else { None },
        });
    }

    let pdf_path = dir.join(format!("{file_stem}.pdf"));
    let success = ok1 && pdf_path.is_file();
    let (errors, warnings) = parse_log(&full_log);

    Ok(CompileOutcome {
        success,
        errors,
        warnings,
        log: full_log,
        pdf_path: if pdf_path.is_file() { Some(pdf_path) } else { None },
    })
}

fn run_pdflatex(dir: &Path, file_name: &str) -> Result<(bool, String), crate::AppError> {
    let output = Command::new("pdflatex")
        .arg("-interaction=nonstopmode")
        .arg("-halt-on-error")
        // Formatiert Fehler als "datei.tex:ZEILE: Meldung" statt nur "! Meldung",
        // damit sich die betroffene Zeile im Editor zuverlässig markieren lässt.
        .arg("-file-line-error")
        .arg("-output-directory")
        .arg(dir)
        .arg(file_name)
        .current_dir(dir)
        .output();

    match output {
        Ok(out) => {
            let mut log = String::new();
            log.push_str(&String::from_utf8_lossy(&out.stdout));
            log.push_str(&String::from_utf8_lossy(&out.stderr));
            Ok((out.status.success(), log))
        }
        Err(e) => Ok((
            false,
            format!(
                "pdflatex konnte nicht gestartet werden: {e}\nIst ein LaTeX-System (z. B. TeX Live) auf dem Server installiert und im PATH?"
            ),
        )),
    }
}

fn run_bibtex(dir: &Path, file_stem: &str) -> Result<(bool, String), crate::AppError> {
    let output = Command::new("bibtex")
        .arg(file_stem)
        .current_dir(dir)
        .output();

    match output {
        Ok(out) => {
            let mut log = String::new();
            log.push_str(&String::from_utf8_lossy(&out.stdout));
            log.push_str(&String::from_utf8_lossy(&out.stderr));
            Ok((out.status.success(), log))
        }
        Err(e) => Ok((false, format!("bibtex konnte nicht gestartet werden: {e}"))),
    }
}

/// Extracts human-readable error and warning entries (with best-effort
/// source line numbers) from a pdflatex/bibtex log.
fn parse_log(log: &str) -> (Vec<CompileIssue>, Vec<CompileIssue>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let lines: Vec<&str> = log.lines().collect();
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_end();

        // --file-line-error Format: "datei.tex:ZEILE: Meldung"
        if let Some((line_num, message)) = parse_file_line_error(trimmed) {
            // Die "==> Fatal error occurred, ..."-Zeile ist nur eine
            // zusätzliche Zusammenfassung derselben, bereits erfassten
            // Fehlerzeile — nicht als eigenständigen Fehler aufnehmen.
            if !message.starts_with("==>") {
                errors.push(CompileIssue {
                    line: Some(line_num),
                    message,
                });
            }
            continue;
        }

        // Fallback: klassisches "! Meldung" (+ folgende "l.ZEILE"-Zeile),
        // falls --file-line-error aus irgendeinem Grund nicht greift.
        if trimmed.starts_with('!') {
            let mut msg = trimmed.trim_start_matches('!').trim().to_string();
            let mut line_num = None;
            if let Some(next) = lines.get(idx + 1) {
                let next_trimmed = next.trim_start();
                if let Some(rest) = next_trimmed.strip_prefix("l.") {
                    let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    line_num = num_str.parse::<usize>().ok();
                    msg = format!("{msg} ({next_trimmed})");
                }
            }
            errors.push(CompileIssue { line: line_num, message: msg });
            continue;
        }

        if let Some(pos) = trimmed.find("LaTeX Warning:") {
            let text = trimmed[pos..].to_string();
            let line_num = extract_input_line_number(&text);
            warnings.push(CompileIssue { line: line_num, message: text });
            continue;
        }

        if trimmed.contains("Warning--") {
            // Typische bibtex-Warnung; bezieht sich i. d. R. auf die
            // .bib-Datei, nicht auf eine Zeile in der .tex-Quelle.
            warnings.push(CompileIssue {
                line: None,
                message: trimmed.to_string(),
            });
        }
    }

    if errors.is_empty() && log.contains("pdflatex konnte nicht gestartet werden") {
        errors.push(CompileIssue {
            line: None,
            message: log.lines().next().unwrap_or("Unbekannter Fehler").to_string(),
        });
    }

    (errors, warnings)
}

/// Parses a line of the form "<datei>:<zeile>: <meldung>" as produced by
/// pdflatex when run with `-file-line-error`. Returns `None` if the line
/// doesn't match (the part before the first colon must end in a common
/// TeX-related file extension, to avoid false positives on unrelated log
/// lines that happen to contain colons).
fn parse_file_line_error(line: &str) -> Option<(usize, String)> {
    let colon1 = line.find(':')?;
    let file_part = &line[..colon1];
    let looks_like_tex_file = [".tex", ".sty", ".cls", ".def", ".cfg"]
        .iter()
        .any(|ext| file_part.ends_with(ext));
    if !looks_like_tex_file {
        return None;
    }

    let rest = &line[colon1 + 1..];
    let colon2 = rest.find(':')?;
    let line_num: usize = rest[..colon2].trim().parse().ok()?;
    let message = rest[colon2 + 1..].trim().to_string();
    if message.is_empty() {
        return None;
    }
    Some((line_num, message))
}

/// Extracts the number from a trailing "... on input line 42." phrase, as
/// commonly appended to LaTeX warnings.
fn extract_input_line_number(text: &str) -> Option<usize> {
    let marker = "on input line ";
    let idx = text.find(marker)?;
    let after = &text[idx + marker.len()..];
    let num_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    if num_str.is_empty() {
        return None;
    }
    num_str.parse().ok()
}
