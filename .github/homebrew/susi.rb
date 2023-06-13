#! Template of Casks/susi.rb in octolab/homebrew-tap, rendered by
#! `.github/scripts/release.mjs cask` and published by cd.yml on a stable tag.
#! Lines starting with "#!" are template comments and never reach the tap.
#! @VERSION@ and @SHA256@ are filled in; the block between "#! adhoc:begin"
#! and "#! adhoc:end" stays only for an ad-hoc signed build.
cask "susi" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "https://github.com/octopot/susi/releases/download/v#{version}/susi_#{version}_darwin-arm64.zip"
  name "Susi"
  desc "Prompt composer with local model rewrites"
  homepage "https://susi.octolab.org/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :tahoe

  app "Susi.app"
#! adhoc:begin

  # The app is ad-hoc signed, not notarized: Gatekeeper refuses it while it
  # carries the quarantine attribute Homebrew sets on every download.
  preflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}/Susi.app"]
  end
#! adhoc:end

  uninstall quit: "me.octopot.susi"

  zap trash: [
    "~/Library/Application Support/me.octopot.susi",
    "~/Library/Caches/me.octopot.susi",
    "~/Library/WebKit/me.octopot.susi",
  ]

  caveats <<~EOS
    Susi rewrites text with a local Ollama model. Install Ollama, then run once:
      ollama pull qwen3.5:4b-mlx
  EOS
end
