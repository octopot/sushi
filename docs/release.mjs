// The release this site documents and what it needs. Pages and components read these values,
// so a change here reaches the landing, the quick start and the guides at once.
// The release note (content/changelog/vX.Y.Z.md) is plain Markdown: update it by hand.
// The release tag check (.github/scripts/release.mjs, x-release.versions in .github/settings.json)
// reads this file as text: keep `version`, `tag` and `archive` as plain single-quoted strings on
// their own lines, naming the same version, or a tag cannot be pushed.
export const release = {
  version: '0.1.1',
  tag: 'v0.1.1',
  slogan: 'Every missing piece, one click away.',
  // Liquid Glass, which the panel is built on, arrived in macOS 26.
  macos: '26',
  chip: 'Apple Silicon',
  model: 'qwen3.5:4b-mlx',
  cask: 'octolab/tap/sushi',
  archive: 'sushi_0.1.1_darwin-arm64.zip',
  repo: 'https://github.com/octopot/sushi',
}
release.download = `${release.repo}/releases/tag/${release.tag}`
release.specs = `${release.repo}/blob/main/docs/specs`
