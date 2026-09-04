use std::path::{Path, PathBuf};
use std::process::Command;

pub struct DiffOutcome {
    pub success: bool,
    pub diff_path: Option<PathBuf>,
    pub log: String,
}

/// Runs `latexdiff old_path new_path`, capturing the resulting marked-up
/// LaTeX source (written by latexdiff to stdout) into a new file placed
/// next to `new_path`. This is a blocking function; call it via
/// `spawn_blocking`.
pub fn run_latexdiff(old_path: &Path, new_path: &Path) -> DiffOutcome {
    let new_dir = new_path.parent().unwrap_or_else(|| Path::new("."));
    let old_stem = old_path.file_stem().and_then(|s| s.to_str()).unwrap_or("alt");
    let new_stem = new_path.file_stem().and_then(|s| s.to_str()).unwrap_or("neu");
    let diff_path = new_dir.join(format!("diff-{old_stem}-vs-{new_stem}.tex"));

    let output = Command::new("latexdiff").arg(old_path).arg(new_path).output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();

            if out.status.success() && !stdout.trim().is_empty() {
                match std::fs::write(&diff_path, &stdout) {
                    Ok(()) => DiffOutcome {
                        success: true,
                        diff_path: Some(diff_path),
                        log: stderr,
                    },
                    Err(e) => DiffOutcome {
                        success: false,
                        diff_path: None,
                        log: format!("Diff-Datei konnte nicht geschrieben werden: {e}\n{stderr}"),
                    },
                }
            } else {
                DiffOutcome {
                    success: false,
                    diff_path: None,
                    log: format!("{stdout}\n{stderr}").trim().to_string(),
                }
            }
        }
        Err(e) => DiffOutcome {
            success: false,
            diff_path: None,
            log: format!(
                "latexdiff konnte nicht gestartet werden: {e}\nIst latexdiff (Teil der meisten TeX-Live-Installationen, Paket \"texlive-extra-utils\" bzw. \"latexdiff\") im PATH des Servers installiert?"
            ),
        },
    }
}
