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
            eprintln!("Warning: filesystem watcher could not be started: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(dir, RecursiveMode::Recursive) {
        eprintln!("Warning: folder could not be watched ({}): {e}", dir.display());
        return;
    }

    loop {
        // Client connection closed? Then shut the watcher down cleanly
        // instead of leaving the thread blocked forever.
        if tx.is_closed() {
            break;
        }

        match raw_rx.recv_timeout(Duration::from_secs(1)) {
            Ok(()) => {
                // Short debounce: collect further events in the same time window
                // so that e.g. a compile run (which writes several files in quick
                // succession) triggers only ONE notification.
                while raw_rx.recv_timeout(Duration::from_millis(300)).is_ok() {}
                if tx.blocking_send(()).is_err() {
                    break; // The client has disconnected in the meantime.
                }
            }
            Err(std_mpsc::RecvTimeoutError::Timeout) => continue, // check again whether tx is still open
            Err(std_mpsc::RecvTimeoutError::Disconnected) => break, // watcher callback was dropped
        }
    }
    // `watcher` is dropped here, which automatically removes the underlying
    // inotify watch.
}
