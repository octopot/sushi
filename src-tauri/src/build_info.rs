//! Which build is running (docs/specs/build-info.md). The menu item and `sushi version` both call
//! [`block`]; nothing else formats build info.

use std::ffi::CStr;

extern "C" {
    fn sushi_signing(team: *mut libc::c_char, size: usize) -> libc::c_int;
}

/// The fields of the block, in its order (BI-1).
#[derive(Clone, Debug, PartialEq)]
pub struct Info {
    pub version: String,
    pub build: String,
    pub date: String,
    pub commit: String,
    pub rust: String,
    pub tauri: String,
    pub webkit: String,
    pub platform: String,
    pub macos: String,
    pub signing: String,
    pub features: String,
}

const UNKNOWN: &str = "unknown";

fn sysctl(name: &CStr) -> Option<String> {
    let mut size = 0;
    let found = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if found != 0 || size == 0 {
        return None;
    }
    let mut buffer = vec![0u8; size];
    let read = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    (read == 0).then(|| {
        CStr::from_bytes_until_nul(&buffer)
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    })
}

/// `27.2 (25C56)`: the running macOS with its build number.
fn macos() -> String {
    match (sysctl(c"kern.osproductversion"), sysctl(c"kern.osversion")) {
        (Some(version), Some(build)) => format!("{version} ({build})"),
        (Some(version), None) => version,
        _ => UNKNOWN.into(),
    }
}

fn signing() -> String {
    let mut team = [0 as libc::c_char; 64];
    let kind = unsafe { sushi_signing(team.as_mut_ptr(), team.len()) };
    let team = unsafe { CStr::from_ptr(team.as_ptr()) }.to_string_lossy();
    match kind {
        1 => "ad-hoc".into(),
        2 => "ad-hoc (linker)".into(),
        3 => format!("Developer ID ({team})"),
        4 => format!("other certificate ({team})"),
        _ => "unsigned".into(),
    }
}

fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        other => other,
    };
    format!("{os}/{arch}")
}

/// The compiled-in Cargo features of Sushi itself, or `-` when none is on.
fn features() -> String {
    // None is declared today; list `cfg!(feature = "…")` here when one is.
    let on: &[&str] = &[];
    if on.is_empty() {
        "-".into()
    } else {
        on.join(", ")
    }
}

/// Reads the running build. The same calls in the menu and in `sushi version`, without a window.
pub fn collect() -> Info {
    Info {
        version: env!("CARGO_PKG_VERSION").into(),
        build: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        date: env!("SUSHI_BUILD_DATE").into(),
        commit: env!("SUSHI_BUILD_COMMIT").into(),
        rust: env!("SUSHI_BUILD_RUST").into(),
        tauri: tauri::VERSION.into(),
        webkit: tauri::webview_version().unwrap_or_else(|_| UNKNOWN.into()),
        platform: platform(),
        macos: macos(),
        signing: signing(),
        features: features(),
    }
}

/// The block, byte for byte as docs/specs/build-info.md shows it (BI-1).
pub fn block(info: &Info) -> String {
    let rows = [
        ("version", &info.version),
        ("build", &info.build),
        ("build date", &info.date),
        ("git hash", &info.commit),
        ("rust", &info.rust),
        ("tauri", &info.tauri),
        ("webkit", &info.webkit),
        ("platform", &info.platform),
        ("macos", &info.macos),
        ("signing", &info.signing),
        ("features", &info.features),
    ];
    let mut out = String::from("sushi:\n");
    for (name, value) in rows {
        out.push_str(&format!("  {name:<12}: {value}\n"));
    }
    out
}

/// `1a2b3c4`, `1a2b3c4-dirty` or `unknown`.
pub fn short_hash(info: &Info) -> String {
    let (hash, dirty) = match info.commit.strip_suffix("-dirty") {
        Some(hash) => (hash, true),
        None => (info.commit.as_str(), false),
    };
    if hash == UNKNOWN {
        UNKNOWN.to_string()
    } else {
        hash.chars().take(7).collect::<String>() + if dirty { "-dirty" } else { "" }
    }
}

/// `Sushi 0.2.1 (1a2b3c4)`, `(1a2b3c4-dirty)` or `(unknown)` (BI-4). The menu no longer has the
/// version row (SUSI-12); the specification's example still checks this form.
#[cfg_attr(not(test), allow(dead_code))]
pub fn title(info: &Info) -> String {
    format!("Sushi {} ({})", info.version, short_hash(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = include_str!("../../docs/specs/build-info.md");

    fn example() -> Info {
        Info {
            version: "0.3.0".into(),
            build: "release".into(),
            date: "2026-11-29T09:30:00Z".into(),
            commit: "0123456789abcdef0123456789abcdef01234567".into(),
            rust: "1.100.0 (0ef1bc386 2026-11-09)".into(),
            tauri: "2.12.7".into(),
            webkit: "21623.1.14.11.4".into(),
            platform: "darwin/arm64".into(),
            macos: "27.2 (25C56)".into(),
            signing: "ad-hoc".into(),
            features: "-".into(),
        }
    }

    /// The fenced block that follows `marker` in the specification, without the indentation of
    /// the list item it sits in.
    fn fenced(marker: &str) -> String {
        let after = SPEC
            .split_once(marker)
            .expect("the specification marks its example")
            .1;
        let (before, body) = after
            .split_once("```text\n")
            .expect("a text block follows the marker");
        let indent = before.rsplit('\n').next().unwrap();
        body.split_once(&format!("{indent}```"))
            .unwrap()
            .0
            .lines()
            .map(|line| line.strip_prefix(indent).unwrap_or(line).to_string() + "\n")
            .collect()
    }

    #[test]
    fn renders_the_block_of_the_specification() {
        assert_eq!(block(&example()), fenced("<!-- block -->"));
        assert_eq!(title(&example()), fenced("<!-- title -->").trim_end());
    }

    #[test]
    fn the_title_is_the_version_and_seven_characters_of_the_hash() {
        let info = example();
        let rendered = block(&info);
        let field = |name: &str| {
            rendered
                .lines()
                .find_map(|l| l.trim_start().strip_prefix(name)?.split_once(": "))
                .map(|(_, v)| v.to_string())
                .unwrap()
        };
        assert_eq!(
            title(&info),
            format!("Sushi {} ({})", field("version"), &field("git hash")[..7])
        );
        let dirty = Info {
            commit: info.commit.clone() + "-dirty",
            ..info.clone()
        };
        assert_eq!(title(&dirty), "Sushi 0.3.0 (0123456-dirty)");
        let unknown = Info {
            commit: "unknown".into(),
            ..info
        };
        assert_eq!(title(&unknown), "Sushi 0.3.0 (unknown)");
    }

    #[test]
    fn the_running_build_fills_every_field() {
        let info = collect();
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert!(
            !info.date.is_empty() && info.date.ends_with('Z'),
            "{info:?}"
        );
        assert!(info.macos.contains('('), "{info:?}");
        assert_eq!(info.platform, "darwin/arm64");
        assert_ne!(info.webkit, UNKNOWN);
        assert_ne!(info.rust, UNKNOWN);
        // A test binary is signed by the linker on Apple silicon.
        assert!(info.signing.starts_with("ad-hoc"), "{}", info.signing);
        let block = block(&info);
        assert_eq!(block.lines().count(), 12);
        // Nothing about the user: no home folder, no user name.
        let home = std::env::var("HOME").unwrap();
        assert!(!block.contains(&home));
        if let Ok(user) = std::env::var("USER") {
            assert!(!block.contains(&user), "{block}");
        }
    }
}
