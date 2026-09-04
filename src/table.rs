use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;
use std::path::Path;

/// Maximum number of data rows returned to the frontend (for preview and
/// for the drag-and-drop \table insertion). Keeps responses small even for
/// large spreadsheets.
const MAX_ROWS: usize = 300;

#[derive(Serialize)]
pub struct TableResult {
    pub sheet_name: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub truncated: bool,
}

/// Reads the first worksheet of an Excel (.xlsx/.xls/.xlsb), OpenDocument
/// (.ods) or CSV file into a generic table structure. The first row is
/// treated as the header row.
pub fn read_table(path: &Path) -> Result<TableResult, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext == "csv" {
        return read_csv_table(path);
    }

    let mut workbook = open_workbook_auto(path).map_err(|e| format!("Datei konnte nicht geöffnet werden: {e}"))?;

    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "Die Datei enthält kein Tabellenblatt.".to_string())?;

    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| format!("Tabellenblatt konnte nicht gelesen werden: {e}"))?;

    let mut rows_iter = range.rows();
    let headers: Vec<String> = match rows_iter.next() {
        Some(first_row) => first_row.iter().map(cell_to_string).collect(),
        None => return Err("Die Datei enthält keine Daten.".to_string()),
    };

    let all_rows: Vec<Vec<String>> = rows_iter
        .map(|row| row.iter().map(cell_to_string).collect())
        .collect();

    let total_rows = all_rows.len();
    let truncated = total_rows > MAX_ROWS;
    let rows = all_rows.into_iter().take(MAX_ROWS).collect();

    Ok(TableResult {
        sheet_name,
        headers,
        rows,
        total_rows,
        truncated,
    })
}

/// Reads a CSV file with a hand-rolled parser (comma- or semicolon-
/// delimited, quote-aware) rather than relying on calamine, which does not
/// reliably auto-detect plain CSV files.
fn read_csv_table(path: &Path) -> Result<TableResult, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("CSV-Datei konnte nicht gelesen werden: {e}"))?;
    let first_line = content.lines().next().unwrap_or("");
    let delimiter = detect_delimiter(first_line);

    let mut all_rows_raw = parse_csv(&content, delimiter).into_iter();
    let headers = all_rows_raw
        .next()
        .ok_or_else(|| "Die CSV-Datei enthält keine Daten.".to_string())?;

    let all_rows: Vec<Vec<String>> = all_rows_raw.collect();
    let total_rows = all_rows.len();
    let truncated = total_rows > MAX_ROWS;
    let rows = all_rows.into_iter().take(MAX_ROWS).collect();

    Ok(TableResult {
        sheet_name: "CSV".to_string(),
        headers,
        rows,
        total_rows,
        truncated,
    })
}

/// Picks ',' or ';' as the delimiter, based on which occurs more often in
/// the header line (many German-locale spreadsheet exports use ';').
fn detect_delimiter(first_line: &str) -> char {
    let comma_count = first_line.matches(',').count();
    let semicolon_count = first_line.matches(';').count();
    if semicolon_count > comma_count {
        ';'
    } else {
        ','
    }
}

/// A small, quote-aware CSV parser: handles quoted fields (with `""` as an
/// escaped quote), fields containing the delimiter or newlines, and both
/// `\n` and `\r\n` line endings.
fn parse_csv(content: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = content.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == delimiter {
            row.push(std::mem::take(&mut field));
        } else if c == '\r' {
            // Ignored; the following '\n' (if any) ends the row.
        } else if c == '\n' {
            row.push(std::mem::take(&mut field));
            rows.push(std::mem::take(&mut row));
        } else {
            field.push(c);
        }
    }

    // Last field/row if the file doesn't end with a trailing newline.
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    // Drop fully empty trailing rows (e.g. from a trailing blank line).
    rows.retain(|r| !(r.len() == 1 && r[0].is_empty()));

    rows
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => format_float(*f),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => dt.to_string(),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("#FEHLER({e:?})"),
    }
}

/// Formats a float without an unnecessary trailing ".0" for whole numbers,
/// which is what most spreadsheet cells with integer-looking values expect.
fn format_float(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        let s = format!("{f}");
        s
    }
}
