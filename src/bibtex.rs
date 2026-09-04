use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct BibEntry {
    pub entry_type: String,
    pub key: String,
    pub fields: BTreeMap<String, String>,
    /// The exact original source text of this entry (from "@" to the
    /// closing "}" inclusive). Used to locate and replace/remove the
    /// entry in the file when editing or deleting it.
    pub raw: String,
}

/// Parses a .bib file's content into a list of entries.
///
/// This is a pragmatic, brace-counting parser rather than a full BibTeX
/// grammar implementation: it is robust to nested braces inside field
/// values (e.g. `title = {{NASA}'s Mission}`) which naive regexes get
/// wrong, but it does not implement string macros (`@string{...}`) or
/// `@comment` / `@preamble` bodies (they are simply skipped).
pub fn parse_bib(content: &str) -> Vec<BibEntry> {
    let mut entries = Vec::new();
    let bytes: Vec<char> = content.chars().collect();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == '@' {
            let entry_start = i;
            // Read entry type (letters until '{' or '(')
            let mut j = i + 1;
            while j < len && bytes[j].is_alphanumeric() {
                j += 1;
            }
            let entry_type: String = bytes[i + 1..j].iter().collect();
            let entry_type_lower = entry_type.to_lowercase();

            // Skip whitespace
            let mut k = j;
            while k < len && bytes[k].is_whitespace() {
                k += 1;
            }

            if k < len && bytes[k] == '{' {
                // Find the matching closing brace for the whole entry.
                let (body, end) = extract_braced(&bytes, k);
                let raw: String = bytes[entry_start..end].iter().collect();
                i = end;

                if entry_type_lower != "comment" && entry_type_lower != "preamble" && entry_type_lower != "string"
                {
                    if let Some((key, fields_str)) = split_key_and_body(&body) {
                        let fields = parse_fields(&fields_str);
                        entries.push(BibEntry {
                            entry_type: entry_type_lower,
                            key,
                            fields,
                            raw,
                        });
                    }
                }
                continue;
            }
        }
        i += 1;
    }

    entries
}

/// Given the text right at an opening '{', returns the inner content
/// (without the outer braces) and the index right after the matching '}'.
fn extract_braced(chars: &[char], open_idx: usize) -> (String, usize) {
    let mut depth = 0i32;
    let mut i = open_idx;
    let start = open_idx + 1;
    let len = chars.len();
    while i < len {
        match chars[i] {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let inner: String = chars[start..i].iter().collect();
                    return (inner, i + 1);
                }
            }
            _ => {}
        }
        i += 1;
    }
    let inner: String = chars[start..len].iter().collect();
    (inner, len)
}

/// Splits `key, field1 = {...}, field2 = {...}` into (key, remaining fields text).
fn split_key_and_body(body: &str) -> Option<(String, String)> {
    let comma_pos = body.find(',')?;
    let key = body[..comma_pos].trim().to_string();
    let rest = body[comma_pos + 1..].to_string();
    if key.is_empty() {
        None
    } else {
        Some((key, rest))
    }
}

/// Parses `field = {value}, field2 = "value2", field3 = 123` pairs.
fn parse_fields(text: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Skip whitespace / commas
        while i < len && (chars[i].is_whitespace() || chars[i] == ',') {
            i += 1;
        }
        if i >= len {
            break;
        }

        // Read field name
        let name_start = i;
        while i < len && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '-') {
            i += 1;
        }
        if i == name_start {
            // Unexpected character; skip it to avoid an infinite loop.
            i += 1;
            continue;
        }
        let name: String = chars[name_start..i].iter().collect();

        // Skip whitespace and '='
        while i < len && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= len || chars[i] != '=' {
            continue;
        }
        i += 1;
        while i < len && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= len {
            break;
        }

        let value: String;
        if chars[i] == '{' {
            let (inner, end) = extract_braced(&chars, i);
            value = inner;
            i = end;
        } else if chars[i] == '"' {
            let start = i + 1;
            let mut j = start;
            while j < len && chars[j] != '"' {
                j += 1;
            }
            value = chars[start..j].iter().collect();
            i = j + 1;
        } else {
            // Bare value (e.g. a number) until the next comma.
            let start = i;
            let mut j = i;
            while j < len && chars[j] != ',' {
                j += 1;
            }
            value = chars[start..j].iter().collect::<String>().trim().to_string();
            i = j;
        }

        fields.insert(name.to_lowercase(), value.trim().to_string());
    }

    fields
}
