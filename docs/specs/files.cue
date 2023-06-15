package sushi

import "strings"

// Mirrors the checks in src-tauri/src/settings.rs and src-tauri/src/library.rs.
// Definitions are closed: an unknown field is an error, as it is in the app.

// Text with at least one character that is not whitespace.
#Text: string & =~"[^\\s]"

// A rule is a model edit (`instruction`) or a local edit that prepends `prefix`
// to the whole prompt. Exactly one of the two is present.
#Rule: {
	id!:   #Text
	name!: #Text
	aliases!: [...#Text]
} & ({instruction!: #Text} | {prefix!: #Text})

#Rules: {
	rules!: [...#Rule]
	// Rule IDs are unique: a repeated ID gives conflicting indexes.
	_ids: {for i, r in rules {(r.id): i}}
}

#Term: {from!: #Text, to!: #Text}

#Dictionary: {
	terms!: [...#Term]
	// Source phrases are unique after trimming and lowercasing.
	_sources: {for i, t in terms {(strings.ToLower(strings.TrimSpace(t.from))): i}}
}

// hotkey.json: Caps Lock shows the panel, or a combination of modifiers and one key.
#Hotkey: {
	capsLock!: bool
	shortcut!: string & =~"^((Control|Ctrl|Option|Alt|Shift|Command|Cmd|Super|Meta)\\+)+[A-Za-z0-9]+$"
}

// model.json: optional; without it, or with "ollama", edits run on Ollama.
#Model: {
	provider!: "ollama" | "openrouter"
	openrouter?: {
		key!:       #Text
		model!:     #Text
		reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
		tier?:      "default" | "flex" | "fast" | "ultrafast"
	}
	if provider == "openrouter" {openrouter!: _}
}

// The YAML frontmatter of a template: a title and nothing else.
#Template: {title!: #Text}
