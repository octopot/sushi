# Acceptance scenarios of model.md: what needs the real app, the native connect screens and a
# real provider account. How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: The model behind an edit
  Requests, failures, the keychain and the connect flow are proven on a mock server by the
  Rust tests. Left for a real session: the native screens, the browser sign-in, and an edit
  through each provider's real API, which costs a little of the account's credits.

  Background:
    Given the build under test runs and Settings ▸ Model is open

  @PR-14 @PN-10 @ST-22 @MD-17 @MD-13 @hands
  Scenario: The connect screen is a sheet of Settings and keeps the keyboard
    Given OpenAI is not connected
    When I click **Connect…** on OpenAI
    Then the connect screen opens as a sheet of Settings, with a field for the key
    When I press Caps Lock and type in the panel
    Then the panel shows over Settings and its sheet, and the typing lands in the panel
    When I press Esc
    Then the keyboard is back in the sheet's key field
    When I click **Cancel**
    Then nothing changed: OpenAI is not connected and the provider in use is the same

  @PR-15 @ST-22 @MD-17 @hands @account
  Scenario: A sign-in that ends while Settings is closed shows no alert
    Given an OpenRouter account, and OpenRouter is not connected
    When I click **Connect…** on OpenRouter, then **Connect** on its sheet
    And I press ⌘W in Settings once the browser opens, then approve in the browser
    Then no alert shows over the browser
    And the Model menu has OpenRouter checked
    When I open Settings
    Then OpenRouter is *In use*
    When I disconnect OpenRouter, connect again, close Settings while the browser waits, and deny in the browser
    Then no alert shows over the browser
    When I open Settings
    Then *OpenRouter is not connected* shows as a sheet
    And the previous choice is in effect

  @PR-28 @MD-14 @ST-22 @hands @account
  Scenario: A sign-in the browser never answers is cancelled
    Given an OpenRouter account, and OpenRouter is not connected
    When I click **Connect…** on OpenRouter, then **Connect** on its sheet, and close the browser tab that opens
    Then the row says *Sushi waits for the browser for 5 minutes.*, with **Cancel** next to *Connecting…*
    When I click **Cancel**
    Then the row offers **Connect…** again and no sheet shows
    And the provider in use is the one it was

  @PR-20 @MD-14 @MD-16 @MD-8 @MD-11 @ST-22 @hands @account
  Scenario: OpenRouter by sign-in, with a real account
    Given an OpenRouter account with credits, and OpenRouter is connected and in use
    When I click **Disconnect…** on OpenRouter
    Then a sheet asks *Disconnect OpenRouter?* and says that edits then run on Ollama
    When I click **Disconnect**
    Then it says the key still works until I delete it on the keys page, and offers **Open the keys page**
    And Ollama is *In use*
    When I click **Connect…** on OpenRouter
    Then the sheet says what leaves this Mac, who pays and which model answers
    When I click **Connect**, sign in and approve in the browser
    Then *Connected to OpenRouter* shows as a sheet of Settings
    And I copied no key and edited no file
    And the key shows on my OpenRouter keys page
    When I write a paragraph in which Codex acts as the skeptic, and run ⌘K with my own instruction to have Codex's remarks read with skepticism instead
    Then the diff changes what the paragraph means
    And the hint names the model that answered and the time, as in `… · gpt-6-luna · 3.0 s · …`

  @PR-21 @MD-6 @MD-1 @hands @account
  Scenario: A hosted provider that is not reachable offers Ollama
    Given a hosted provider is connected and in use, and Ollama runs
    And Sushi is quit and started so that hosted requests cannot leave this Mac, while Ollama on 127.0.0.1 is untouched:
      """
      osascript -e 'quit app "Sushi"'
      open -g --env HTTPS_PROXY=http://127.0.0.1:9 /Applications/Sushi.app
      """
    When I type a phrase in the panel and run ⌘K with Shorten
    Then the hint says `<Name> is not reachable. Edit with Ollama`
    When I choose **Edit with Ollama**
    Then the same edit arrives from Ollama, and the hint names the local model
    When I quit Sushi, start it without the variable and run the edit again
    Then the provider answers

  @PR-22 @MD-13 @MD-15 @MD-16 @MD-8 @ST-21 @hands @account
  Scenario: OpenAI by a pasted key, with a real account
    Given an OpenAI API key with credits, and OpenAI is not connected
    When I click **Connect…** on OpenAI, type a few letters into the key field and click **Connect**
    Then the sheet stays and says *This does not look like an API key.*
    When I paste the real key with its last character changed and click **Connect**
    Then the sheet stays and says *OpenAI did not accept this key. Copy it again from the keys page.*
    When I paste the real key
    Then the line under the field shows its first seven and last four characters and its length, like `sk-proj…9fQ2 · 164 characters`
    When I click **Connect**
    Then *Connected to OpenAI* shows as a sheet of Settings
    When I click **Use for edits** on OpenAI and open the Model menu
    Then OpenAI has the check mark
    When I type a phrase in the panel and run ⌘K with Shorten
    Then the diff arrives and the hint names the OpenAI model that answered
    When I click **Disconnect…** on OpenAI and confirm
    Then OpenAI is not connected and Ollama is *In use*

  @PR-23 @MD-13 @MD-16 @MD-8 @ST-23 @hands @account
  Scenario: Claude by a pasted key, with a real account
    Given an Anthropic API key from the Console with credits, and Claude is not connected
    When I click **Connect…** on Claude, paste the real key with its last character changed and click **Connect**
    Then the sheet stays and says that Claude did not accept this key
    When I paste the real key and click **Connect**
    Then *Connected to Claude* shows as a sheet of Settings
    When I click **Use for edits** on Claude, type a phrase in the panel and run ⌘K with Shorten
    Then the diff arrives and the hint names the Claude model that answered
    When I change *Effort* under *Advanced* on Claude
    Then `model.json` holds the new `effort` in its `anthropic` section
    When I click **Disconnect…** on Claude and confirm
    Then Claude is not connected and Ollama is *In use*
