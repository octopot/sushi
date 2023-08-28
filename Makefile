# Named entry points of the release process; the npm scripts in package.json
# stay the way to build, run and test the app.

.DEFAULT_GOAL = verify
GIT_HOOKS     = post-merge pre-commit pre-push
MANIFEST      = --manifest-path src-tauri/Cargo.toml
ARTIFACTS    ?= artifacts
SIGNING      ?= adhoc

AT    := @
SHELL := /usr/bin/env bash -euo pipefail -c

help:
	@LC_ALL=C $(MAKE) -pRrq -f $(firstword $(MAKEFILE_LIST)) : 2>/dev/null \
	| awk -v RS= -F: '/(^|\n)# Files(\n|$$)/,/(^|\n)# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' \
	| sort \
	| grep -E -v -e '^[^[:alnum:]]' -e '^$@$$' || true
.PHONY: help

# versioned hooks take effect in place, see octomation/makefiles#81
git-hooks:
	$(AT) git config --local core.hooksPath .github/hooks
.PHONY: git-hooks

git-unhook:
	$(AT) git config --local --unset core.hooksPath || true
.PHONY: git-unhook

define hook_tpl
git-$(1):
	$$(AT) .github/hooks/$(1) < /dev/null
.PHONY: git-$(1)
endef
$(foreach hook,$(GIT_HOOKS),$(eval $(call hook_tpl,$(hook))))

git-check:
	$(AT) git diff --exit-code >/dev/null
	$(AT) git diff --cached --exit-code >/dev/null
	$(AT) ! git ls-files --others --exclude-standard | grep -q ^
.PHONY: git-check

deps:
	$(AT) npm ci
.PHONY: deps

setup: git-hooks deps
.PHONY: setup

lint:
	$(AT) npx --no-install tsc --noEmit
	$(AT) npx --no-install tsc --noEmit -p docs/demo
	$(AT) cargo fmt $(MANIFEST) --check
	$(AT) cargo clippy $(MANIFEST) --release --all-targets -- -D warnings
.PHONY: lint

# npm test builds the frontend and runs the scenarios in headless Chrome.
test:
	$(AT) npm test
	$(AT) cargo test $(MANIFEST) --release
.PHONY: test

# src/bindings/ from the Rust types the commands return, and tests/fixtures/prefs/ from real
# replies of the settings window; the Rust tests fail while either is stale.
bindings:
	$(AT) SUSHI_WRITE_BINDINGS=1 cargo test $(MANIFEST) --release -- bindings:: prefs_fixtures_are_current
.PHONY: bindings

release-helpers-test:
	$(AT) node --test .github/scripts/*.test.mjs
.PHONY: release-helpers-test

# The settings and the shipped examples against their schemas: needs cue only.
examples-vet:
	$(AT) cue vet -c .github/settings.cue .github/settings.json
	$(AT) cue vet docs/specs/files.cue docs/specs/examples/rules.json -d '#Rules'
	$(AT) cue vet docs/specs/files.cue docs/specs/examples/dictionary.json -d '#Dictionary'
	$(AT) cue vet docs/specs/files.cue docs/specs/examples/hotkey.json -d '#Hotkey'
	$(AT) cue vet docs/specs/files.cue docs/specs/examples/model.json -d '#Model'
	$(AT) cue vet docs/specs/files.cue docs/specs/examples/diagnostics.json -d '#Diagnostics'
.PHONY: examples-vet

# The same, then what the app writes and offers against files.cue: builds the app, so macOS.
config-vet: examples-vet
	$(AT) cargo test $(MANIFEST) --release --quiet files_schema_corpus
	$(AT) node .github/scripts/files-schema.mjs
.PHONY: config-vet

# The acceptance scenarios of docs/specs/*.feature against the specifications: ids, tags,
# the rules they name, and the index in panel.md.
scenarios:
	$(AT) node .github/scripts/scenarios.mjs lint
.PHONY: scenarios

# make checklist ARGS='--tag smoke', or --rule PN-8, --id PR-10, --skip account, --out <file>
checklist:
	$(AT) node .github/scripts/scenarios.mjs checklist $(ARGS)
.PHONY: checklist

workflows-check:
	$(AT) if command -v actionlint >/dev/null; then actionlint; else echo 'actionlint is not installed; skipping the workflow check' >&2; fi
.PHONY: workflows-check

# What the pre-push hook runs on every push and ci runs on main.
verify: lint test release-helpers-test scenarios config-vet workflows-check
.PHONY: verify

version:
	$(AT) node .github/scripts/release.mjs version
.PHONY: version

# git tag -s vX.Y.Z && make release-check TAG=vX.Y.Z, before the push
release-check: config-vet
	$(AT) test -n "$(TAG)" || { echo 'usage: git tag -s vX.Y.Z && make release-check TAG=vX.Y.Z'; exit 2; }
	$(AT) node .github/scripts/release.mjs check $(TAG) --local
.PHONY: release-check

doctor:
	$(AT) node .github/scripts/release.mjs doctor
.PHONY: doctor

# runs the doctor workflow on main and waits for its result: unlike doctor, it
# mints the tap token from the Releaser App
workflow-doctor:
	$(AT) last() { gh run list -w doctor.yml -e workflow_dispatch -L 1 --json databaseId -q '.[0].databaseId'; }; \
	before="$$(last)"; \
	gh workflow run doctor.yml --ref main -f reason="$(or $(REASON),make workflow-doctor)"; \
	for _ in $$(seq 30); do sleep 2; id="$$(last)"; [ -n "$$id" ] && [ "$$id" != "$$before" ] && break; done; \
	gh run watch --exit-status "$$id"
.PHONY: workflow-doctor

bundle:
	$(AT) npm run bundle
.PHONY: bundle

# The release archive, checksums.txt and the cask for those bytes in
# $(ARTIFACTS)/, as cd builds them; nothing is published.
dist: bundle dist-package
.PHONY: dist

dist-package:
	$(AT) node .github/scripts/release.mjs package --out $(ARTIFACTS) --signing $(SIGNING)
.PHONY: dist-package

dist-clean:
	$(AT) rm -rf $(ARTIFACTS)
.PHONY: dist-clean
