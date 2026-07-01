use chrono::DateTime;

/// Unix milliseconds → RFC3339 UTC string (e.g. `"2026-07-01T12:00:00+00:00"`), the
/// same shape the frontend already parses via `Date.parse()` for Claude's
/// `resets_at`. Shared by the Codex (seconds → ×1000) and z.ai (already ms)
/// collectors so the conversion is written and tested once.
pub fn unix_ms_to_iso(ms: i64) -> Option<String> {
    let dt = DateTime::from_timestamp_millis(ms)?;
    Some(dt.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_a_known_timestamp() {
        // 2026-07-01T12:00:00Z
        assert_eq!(unix_ms_to_iso(1782907200000).as_deref(), Some("2026-07-01T12:00:00+00:00"));
    }

    #[test]
    fn rejects_out_of_range() {
        assert_eq!(unix_ms_to_iso(i64::MAX), None);
    }
}
