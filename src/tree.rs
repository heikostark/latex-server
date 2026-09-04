use crate::is_hidden;
use serde::Serialize;
use std::path::Path;

const MAX_DEPTH: usize = 8;

#[derive(Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

/// Recursively builds a tree of the given directory, skipping hidden files
/// and common build clutter, up to MAX_DEPTH levels.
pub fn build_tree(path: &Path, depth: usize) -> std::io::Result<TreeNode> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let mut node = TreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: path.is_dir(),
        children: Vec::new(),
    };

    if path.is_dir() && depth < MAX_DEPTH {
        let mut entries: Vec<_> = std::fs::read_dir(path)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| !is_hidden(p))
            .collect();

        // Directories first, then files, both alphabetically.
        entries.sort_by(|a, b| {
            let a_dir = a.is_dir();
            let b_dir = b.is_dir();
            match (a_dir, b_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase()
                    .cmp(&b.file_name().unwrap_or_default().to_string_lossy().to_lowercase()),
            }
        });

        for entry in entries {
            if let Ok(child) = build_tree(&entry, depth + 1) {
                node.children.push(child);
            }
        }
    }

    Ok(node)
}
