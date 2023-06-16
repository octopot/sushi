use std::{
    env,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

include!("build_git.rs");

/// The crate's folder, where git runs.
fn manifest_dir() -> Option<PathBuf> {
    env::var_os("CARGO_MANIFEST_DIR").map(PathBuf::from)
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn utc(seconds: i64) -> String {
    let (year, month, day) = civil(seconds.div_euclid(86_400));
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// The commit and the build date for docs/specs/build-info.md, BI-2 and BI-3.
fn build_info() {
    for name in [
        "SOURCE_DATE_EPOCH",
        "SUSHI_BUILD_COMMIT",
        "SUSHI_BUILD_DATE",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let dir = manifest_dir();
    println!("cargo:rerun-if-changed=build_git.rs");
    for path in dir.as_deref().map(watched_in).unwrap_or_default() {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    let commit = env::var("SUSHI_BUILD_COMMIT")
        .ok()
        .filter(|c| !c.trim().is_empty())
        .map(|c| c.trim().to_string())
        .or_else(|| commit_in(dir.as_deref()?))
        .unwrap_or_else(|| "unknown".into());
    let date = env::var("SUSHI_BUILD_DATE")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .map(|d| d.trim().to_string())
        .or_else(|| {
            let epoch: i64 = env::var("SOURCE_DATE_EPOCH").ok()?.trim().parse().ok()?;
            Some(utc(epoch))
        })
        .unwrap_or_else(|| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs() as i64);
            utc(now)
        });
    let rustc = env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let rust = Command::new(rustc)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map(|v| v.strip_prefix("rustc ").unwrap_or(&v).to_string())
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=SUSHI_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=SUSHI_BUILD_DATE={date}");
    println!("cargo:rustc-env=SUSHI_BUILD_RUST={rust}");
}

fn main() {
    cc::Build::new()
        .file("src/macos.m")
        .flag("-fobjc-arc")
        .compile("sushi_macos");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=QuartzCore");
    println!("cargo:rustc-link-lib=framework=IOKit");
    println!("cargo:rustc-link-lib=framework=Security");
    println!("cargo:rustc-link-lib=framework=Carbon");
    println!("cargo:rerun-if-changed=src/macos.m");
    build_info();
    tauri_build::build();
}
