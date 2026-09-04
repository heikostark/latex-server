use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tokio::sync::mpsc as tokio_mpsc;

/// Watches `dir` recursively for filesystem changes and sends a
/// notification on `tx` whenever something changes, debounced so that a
/// burst of rapid changes (e.g. pdflatex writing several files during a
/// compile) results in a single notification. Runs until either the
/// watched directory can no longer be read or `tx`'s receiver is dropped
/// (i.e. the SSE client disconnected). Blocking; must be called from a
/// dedicated thread (e.g. via `spawn_blocking`).
pub fn watch_directory(dir: &Path, tx: tokio_mpsc::Sender<()>) {
    let (raw_tx, raw_rx) = std_mpsc::channel::<()>();

    let mut watcher = match RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = raw_tx.send(());
            }
        },
        notify::Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Warnung: Dateisystem-Überwachung konnte nicht gestartet werden: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(dir, RecursiveMode::Recursive) {
        eprintln!("Warnung: Ordner konnte nicht überwacht werden ({}): {e}", dir.display());
        return;
    }

    loop {
        // Client-Verbindung geschlossen? Dann Überwachung sauber beenden,
        // statt den Thread für immer blockiert zu lassen.
        if tx.is_closed() {
            break;
        }

        match raw_rx.recv_timeout(Duration::from_secs(1)) {
            Ok(()) => {
                // Kurze Entprellung: weitere Ereignisse im selben Zeitfenster
                // sammeln, damit z.B. ein Kompilierlauf (der mehrere Dateien
                // kurz hintereinander schreibt) nur EINE Benachrichtigung auslöst.
                while raw_rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
                if tx.blocking_send(()).is_err() {
                    break; // Client hat inzwischen getrennt.
                }
            }
            Err(std_mpsc::RecvTimeoutError::Timeout) => continue, // erneut prüfen, ob tx noch offen ist
            Err(std_mpsc::RecvTimeoutError::Disconnected) => break, // Watcher-Callback wurde gedroppt
        }
    }
    // `watcher` wird hier gedroppt, wodurch das zugrunde liegende inotify-Watch
    // automatisch entfernt wird.
}
