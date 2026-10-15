//! Files handed to external applications stay private and live for this session.
use super::{Error, Result};
use std::{io::Write, path::PathBuf};

pub fn prepare(filename: &str, bytes: &[u8]) -> Result<(tempfile::TempDir, PathBuf)> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("zusteller-attachment-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    let directory = builder
        .tempdir()
        .map_err(|_| Error::new("invalid", "Could not create attachment storage"))?;
    // Treat both separator styles as paths, regardless of the host OS.
    let name = filename
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .unwrap_or("attachment");
    let path = directory.path().join(name);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|_| Error::new("invalid", "Could not prepare the attachment"))?;
    #[cfg(target_os = "macos")]
    {
        // Preserve macOS checks for files received from an external source.
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let quarantine = format!("0083;{timestamp:x};Zusteller;");
        let status = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.apple.quarantine", &quarantine])
            .arg(&path)
            .status()
            .map_err(|_| Error::new("invalid", "Could not protect the attachment"))?;
        if !status.success() {
            return Err(Error::new("invalid", "Could not protect the attachment"));
        }
    }
    Ok((directory, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolates_files_preserves_extensions_and_removes_them_on_drop() {
        let (directory, path) = prepare("../../report.pdf", b"contents").unwrap();
        let (other, other_path) = prepare("C:\\mail\\report.pdf", b"other").unwrap();
        assert_eq!(path.file_name().unwrap(), "report.pdf");
        assert_eq!(other_path.file_name().unwrap(), "report.pdf");
        assert_ne!(path, other_path);
        assert_eq!(std::fs::read(&path).unwrap(), b"contents");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(directory.path())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        #[cfg(target_os = "macos")]
        assert!(std::process::Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(&path)
            .output()
            .unwrap()
            .status
            .success());
        drop(directory);
        assert!(!path.exists());
        assert!(other_path.exists());
        drop(other);
    }

    #[test]
    fn empty_and_parent_names_cannot_escape_storage() {
        for name in ["", ".", "..", "/", "folder/"] {
            let (_directory, path) = prepare(name, b"file").unwrap();
            assert_eq!(path.file_name().unwrap(), "attachment");
        }
    }
}
