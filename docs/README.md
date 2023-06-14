# Sushi documentation

An English site for Sushi v0.2.0: a product landing page with the real panel running in the browser, a quick start, guides and the changelog. Nextra 4 on Next.js, the same stack and layout as the indexit and maintainer sites.

## Run locally

Use Node 24 (the CI version). From `docs/`:

```sh
npm ci
npm run dev
```

Open <http://localhost:3100>. `npm run dev` first builds the interactive panel (see [below](#the-interactive-panel)); rerun `npm run demo` after a change in `../src` or `demo/`.

## Build

For GitHub Pages, from `docs/`:

```sh
npm ci
TARGET=static SITE_URL=https://sushi.octolab.org/ npm run build
```

This is everything CI needs: no install in the repository root. Static output is written to `docs/dist/`. `SITE_URL` is required; add `BASE_PATH=/sushi` only when hosting under a path, as on the default `octopot.github.io/sushi/`. The build also reads the app's `../index.html`, `../src/`, `../tsconfig.json` and `../package.json`, and `specs/examples/`; `.github/workflows/cd.docs.yml` runs when any of them changes.

For a production server: `npm run build`, then `npm start`.

## Edit the content

| Location | Purpose |
| --- | --- |
| `content/index.mdx` | The landing page: hero, the stage with the panel, one section per idea, keys, scope, install |
| `components/stage.jsx` | The stage: a pretend desktop with the real panel, the guided tour, the buttons for touch and pointer |
| `components/showcase.jsx` | The section illustrations: selection and diff, version chain, voice, library, `/goal`, local only |
| `components/install.jsx`, `components/keys.jsx` | Copyable install commands; keycaps |
| `release.mjs` | The version, minimum macOS, chip, model, cask and archive name used across the pages |
| `content/quick-start.mdx` | Install, first prompt, first edit, sending it |
| `content/guide/` | Editing and versions, actions, voice, `/goal`, library and files, the model, keys, troubleshooting |
| `content/changelog/index.mdx` | Release overview |
| `content/changelog/v0.2.0.md` | The latest release notes, also the GitHub release body |
| `content/changelog/v0.1.1.md` | Release notes of Susi v0.1.1 |
| `content/changelog/v0.1.0.md` | First release notes, as Susi |
| `content/**/_meta.js` | Navigation order and labels |
| `navigation.mjs` | Release groups in the sidebar; keeps published release URLs unchanged |
| `app/globals.css` | Shared styles, byte-identical to octopot/indexit |
| `app/brand.css` | Sushi's colour tokens over the shared styles |
| `app/landing.css` | The landing page, the stage and the illustrations |
| `app/layout.jsx` | Site identity and Nextra theme |
| `app/[[...mdxPath]]/page.jsx` | Page titles and social metadata |
| `demo/` | The build of the interactive panel: Vite config, IPC shim, scripted answers |
| `public/icon.svg` | The favicon: the app's mark, `../src/mark.svg` |
| `public/og.png` | The social preview of the home page, 1733×908; other pages share a link without an image |
| `scripts/og.html`, `scripts/og.mjs` | The source of `og.png` and its renderer: `npm run og` |

The public origin in metadata comes from `SITE_URL` (see `site.mjs`). Internal links use Next.js/Nextra and keep the configured base path. Quick start lives at `/quick-start/`; the sidebar groups it with the guides through `_meta.js`. The changelog is a section of the same sidebar, with All releases first; `navigation.mjs` groups release pages into `v0.1.x` and later branches, newest first. Keep release notes at `content/changelog/{tag}.md`.

## The interactive panel

The hero runs Sushi's own interface, not a copy. `npm run demo` (part of `dev` and `build`) builds the app's `../index.html` and `../src/` with Vite into `public/demo/`, which is generated and ignored by Git. `demo/vite.config.mjs` adds one script before `src/main.ts`, `demo/shim.ts`, which:

- answers the Tauri IPC calls the app makes, as `tests/composer.test.mjs` does: settings from `docs/specs/examples/`, three sample saved prompts, copy, hide, and rewrites;
- answers rewrites with `demo/answers.ts`: exact edits for the tour's sample prompt and simple text rules for other text, after a short pause. The page says so under the stage;
- keeps the panel's theme in step with the site's switch, and lets the page drive it (`window.sushiDemo`) without taking keyboard focus.

The panel runs in an iframe, so its shortcuts work only while it has focus and never on the page around it. The tour starts when the stage scrolls into view, stops at the visitor's first click, tap or key inside the panel, and replays a few times at most. With reduced motion, the stage shows a finished edit instead. Only a copy the visitor makes reaches their clipboard. Outside macOS, Ctrl stands in for ⌘.

The app's runtime dependencies are also `devDependencies` here, so `npm ci` in `docs/` is enough to build the panel. The Vite config stops the build when their versions differ from the root `package.json`: update both together. It also stops when `index.html` no longer loads `/src/main.ts`.

When the app's frontend changes, check the tour: `components/stage.jsx` relies on the IPC commands, the `.cm-editor`, `#previous`, `#next`, `#hint`, `#action` and `.palette` elements and the action names in `rules.json`.

## Change the domain

The site is served from the custom domain `sushi.octolab.org`, recorded as `pages.cname` in [`.github/settings.json`](../.github/settings.json); `octopot.github.io/sushi/` redirects to it, keeping the path. The build bakes the domain into asset paths and metadata, and changing it in Settings → Pages triggers no rebuild. To change it:

1. Change Settings → Pages → Custom domain.
2. Update `pages.cname` to match (remove it for the default domain), and the places that spell the domain out: the cask's `homepage` in [`.github/homebrew/sushi.rb`](../.github/homebrew/sushi.rb), the build commands here and in `AGENTS.md`, `scripts/og.html` (then `npm run og`) and the site links in `specs/`. Push to main: a change to `.github/settings.json` runs [`cd.docs.yml`](../.github/workflows/cd.docs.yml), which rebuilds and deploys the site; otherwise run `gh workflow run cd.docs.yml -f reason="domain change"`.

While the two disagree, `cd.docs.yml` stops before building (`release.mjs pages` compares the Pages URL with `pages.cname`), and so does `cd` on a release tag. After the deployment, the workflow smoke-tests the site: its pages and assets, the 404 page and the redirect from the default domain. The daily [doctor](../.github/workflows/doctor.yml) and `make doctor` compare the Pages domain and Enforce HTTPS with `.github/settings.json` and smoke-test the live site, so a site still built for the old domain shows up there.

## Keep the release accurate

The app is the source of truth: check every claim against `src/`, `src-tauri/src/` and the tests, and the precise rules against [`docs/specs/`](specs/). Do not describe planned features as shipped; the landing's scope section lists what this release does not include.

`release.mjs` holds the version, the minimum macOS, the chip, the model, the cask and the archive name for the landing, the quick start and the guides. It is one of the version files of the release tag check (`x-release.versions` in `.github/settings.json`): a tag `vX.Y.Z` is refused unless `version` is `X.Y.Z`, `tag` is `vX.Y.Z` and `archive` names the same version. The check reads the file as text, so keep those three as plain `key: '…'` strings on their own lines. The release note is plain Markdown and repeats some of them: update it by hand. For a new release:

- write `content/changelog/vX.Y.Z.md` (the GitHub release body): user-facing changes only, site-relative links with a trailing slash, Markdown and HTML without MDX, ending with an **Upgrade:** paragraph after the first release;
- add it on top of `content/changelog/_meta.js`, and a card `vX.Y.Z · LATEST` to `content/changelog/index.mdx`, the previous one becoming `· STABLE`;
- update `release.mjs`, the release pill and the description in `content/index.mdx`, and the content table above.

```sh
grep -rn '0\.1\.0' content release.mjs README.md  # only old notes and cards may keep the old version
TARGET=static SITE_URL=https://sushi.octolab.org/ npm run build
```

Lead installation with Homebrew. The manual download is not notarized in v0.2.0, and the quick start says how to open it; change that paragraph once a notarized build ships.

`package.json` pins Zod to `4.1.12` under `nextra-theme-docs` and overrides `@xmldom/xmldom` for `speech-rule-engine`, as in the indexit docs; see its README for the reasons and when to drop them.

Three Dependabot alerts of the site are dismissed, none of them reaches `Sushi.app`:

- Zod before 4.6.6 can exhaust memory (GHSA-mrhx-c7xc-m3w5): a tolerable risk, since only the static build validates the repository's own files. The fix for the regression, [shuding/nextra#4990](https://github.com/shuding/nextra/pull/4990), is merged but not released; once a Nextra release after 4.6.1 ships it, move the override to `4.6.6` or later, or drop it, and check the static export.
- minimatch 10 comes through `ts-morph`, which the site does not use. Its advisory GHSA-g3hv-75wg-m249 needs `optimizationLevel` 2 or more, while `@ts-morph/common` calls minimatch without options, at level 1: not used. Look again when `ts-morph` or its glob options change.
- KaTeX 0.16 (GHSA-238p-pmpm-9mq7) renders nothing: `latex` is off and the pages have no math or Mermaid: not used. It goes away with Nextra's own upgrade.

Search is disabled: static search indexing is not configured.
