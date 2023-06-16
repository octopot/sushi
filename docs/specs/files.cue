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
// Modifiers are case-insensitive, as in the app; Sushi writes them as Control, Option,
// Shift, Command and the key as its physical code (KeyP, Digit1, Space). Only the app
// checks that the key name is one it knows.
#Hotkey: {
	capsLock!: bool
	shortcut!: string & =~"^((?i:control|ctrl|option|alt|shift|command|cmd|super|commandorcontrol|commandorctrl|cmdorctrl|cmdorcontrol)\\+)+[A-Za-z0-9]+$"
}

// model.json: optional; without it, or with "ollama", edits run on Ollama.
// Sushi writes it from the Model menu and the settings window; keys live in the keychain.
// src-tauri/src/model.rs offers the same values: `make config-vet` compares them.
#Reasoning: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
#Model: {
	provider!: "ollama" | "openrouter" | "openai" | "anthropic"
	openrouter?: {
		// Only in files from v0.2.1: Sushi moves it to the keychain.
		key?:       #Text
		model?:     #Text
		reasoning?: #Reasoning
		tier?:      "default" | "flex" | "fast" | "ultrafast"
	}
	openai?: {
		model?:     #Text
		reasoning?: #Reasoning
	}
	anthropic?: {
		model?:  #Text
		effort?: "low" | "medium" | "high" | "xhigh" | "max"
	}
}

// diagnostics.json: optional; the settings window creates it with its switch.
#Diagnostics: {record!: bool}

// The YAML frontmatter of a template: a title and nothing else.
#Template: {title!: #Text}
