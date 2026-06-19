/// Validate that a spawn cwd exists and is a directory.
/// Returns the canonicalized path string, or an error message.
pub fn validate_cwd(path: &str) -> Result<String, String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(format!("cwd does not exist: {path}"));
    }
    if !p.is_dir() {
        return Err(format!("cwd is not a directory: {path}"));
    }
    p.canonicalize()
        .map(|c| c.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot canonicalize {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_dir() {
        let r = validate_cwd("/no/such/dir/xyz123");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn accepts_temp_dir() {
        let tmp = std::env::temp_dir();
        let r = validate_cwd(tmp.to_str().unwrap());
        assert!(r.is_ok());
    }
}
