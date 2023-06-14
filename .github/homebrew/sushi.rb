#! Template of Casks/sushi.rb in octolab/homebrew-tap, rendered by
#! `.github/scripts/release.mjs cask` and published by cd.yml on a stable tag.
#! Lines starting with "#!" are template comments and never reach the tap.
#! @VERSION@ and @SHA256@ are filled in; the block between "#! adhoc:begin"
#! and "#! adhoc:end" stays only for an ad-hoc signed build.
cask "sushi" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "https://github.com/octopot/sushi/releases/download/v#{version}/sushi_#{version}_darwin-arm64.zip"
  name "Sushi"
  desc "Prompt composer with local model rewrites"
  homepage "https://sushi.octolab.org/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :tahoe

  app "Sushi.app"
#! adhoc:begin

  # The app is ad-hoc signed, not notarized: Gatekeeper refuses it while it
  # carries the quarantine attribute Homebrew sets on every download.
  preflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}/Sushi.app"]
  end
#! adhoc:end

  uninstall quit: "me.octopot.sushi"

  zap trash: [
    "~/Library/Application Support/me.octopot.sushi",
    "~/Library/Caches/me.octopot.sushi",
    "~/Library/WebKit/me.octopot.sushi",
  ]

  caveats <<~EOS
    Sushi rewrites text with a local Ollama model. Install Ollama, then run once:
      ollama pull qwen3.5:4b-mlx
  EOS
end
