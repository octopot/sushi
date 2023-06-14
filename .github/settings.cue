// Schema for .github/settings.json: the repository settings that cannot be
// derived at runtime. Validate with `make config-vet`.
//
// Derived, never stored here: owner/name (git remote, GITHUB_REPOSITORY),
// the default branch (origin/HEAD, the event payload, the API), the site URL
// (actions/configure-pages, checked against pages), the version (the files
// listed in x-release.versions, which must agree).
//
// The top level stays open for GitHub REST shaped sections, e.g. repository,
// pages or rulesets, once they are managed from this file.
package settings

#Settings: {
	// Release policy, read by .github/scripts/release.mjs from the tagged
	// commit: the pre-push hook, `make release-check` and cd.yml.
	"x-release"?: #Release

	// Secrets the workflows need, by name. Values never live here.
	// `make doctor` checks that each required one exists and is passed by a
	// workflow, and prints how to create a missing one.
	secrets?: [Name=string & =~"^[A-Z_][A-Z0-9_]*$"]: #Secret

	// GitHub Pages as the REST API reports it (GET /repos/{owner}/{repo}/pages).
	// The docs build bakes the site URL in, so cd.docs.yml and cd.yml refuse
	// to build when Pages disagrees, and `make doctor` reports the drift.
	pages?: #Pages

	// Workflows kept off on purpose, by file name. `make doctor` expects
	// these in the declared state and every other workflow active.
	workflows?: [File=string & =~"^[A-Za-z0-9._-]+\\.ya?ml$"]: #Workflow

	...
}

#Release: {
	// Which tags are releases. A tag matching refs/tags/v* (the cd.yml
	// trigger) but not this pattern is refused.
	tag_pattern: string | *"^v\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$"

	// The curated note of a release; {tag} is replaced with the tag name.
	// It is both a docs page and the GitHub release body.
	notes: string | *"docs/content/changelog/{tag}.md"

	// Where a release tag must point. The first rule whose regexp matches
	// the tag wins; $1… expand its groups. With no match, the default branch.
	// Example for maintenance lines: {match: "^v(\\d+)\\.", branch: "v$1"}.
	branches: [...{
		match:  string
		branch: string
	}] | *[]

	// Files that carry the version; a release tag vX.Y.Z requires X.Y.Z in
	// every one of them. Supported: package.json, tauri.conf.json (the
	// "version" key), Cargo.toml ([package] version), Cargo.lock (the entry
	// of the package named in Cargo.toml), the site's release.mjs (a
	// `version: '…'` line, with `tag` and `archive` naming the same version).
	versions: [...string] & [_, ...]

	// The bundle tauri build produces in src-tauri/target/release/bundle/macos.
	app: string & =~"\\.app$"

	// The release archive; {version} is the version without "v".
	asset: string & =~"\\{version\\}"

	// The Homebrew tap that receives the cask on a stable release.
	tap: #Tap
}

#Tap: {
	owner: string
	name:  string & =~"^homebrew-"

	// Path of the cask in the tap.
	cask: string & =~"^Casks/[a-z0-9-]+\\.rb$"

	// Old tokens of this cask: the tap job deletes their files and maps them to
	// the new token in cask_renames.json, in the same commit as the cask.
	renamed_from?: [...string & =~"^[a-z0-9-]+$"]

	// The cask template in this repository; release.mjs cask fills in
	// @VERSION@ and @SHA256@ and keeps or drops the ad-hoc block.
	template: string
}

#Pages: {
	// The custom domain; absent means https://<owner>.github.io/<repo>/.
	// Settings → Pages → Custom domain, not a CNAME file: a workflow
	// deployment ignores it.
	cname?: string & =~"^[a-z0-9.-]+$"

	https_enforced?: bool

	// The docs are built by cd.docs.yml, not from a branch.
	build_type?: "workflow"
}

#Workflow: {
	// The state as the REST API reports it
	// (GET /repos/{owner}/{repo}/actions/workflows).
	state: "disabled_manually"

	// Why it is off; `make doctor` prints it.
	reason?: string
}

#Secret: {
	// Where the secret is expected to be set.
	scope: "repository" | "organization" | "environment"

	// An optional secret switches a feature on when present: Slack
	// notifications, Developer ID signing and notarization. `make doctor`
	// reports it as off instead of failing.
	optional?: bool
}

#Settings
