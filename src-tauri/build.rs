fn main() {
    cc::Build::new()
        .file("src/macos.m")
        .flag("-fobjc-arc")
        .compile("sushi_macos");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=QuartzCore");
    println!("cargo:rustc-link-lib=framework=IOKit");
    println!("cargo:rerun-if-changed=src/macos.m");
    tauri_build::build();
}
