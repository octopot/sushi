# Acceptance scenarios of panel.md: what needs the real app in a real macOS session.
# How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: The panel on screen
  Window showing, Spaces, focus and dictation go through the window server and other apps,
  so no automated test reaches them. Run these before a release that touches show_launcher,
  hide, the window code in src-tauri/src/macos.m, the settings window, the menu, the key that
  shows Sushi or the way rewrite.rs starts Ollama.

  Background:
    Given the installed Sushi is quit and the build under test runs, started with:
      """
      open -g <path>/Sushi.app --args --hidden
      """
    And Caps Lock is the key that shows Sushi

  @PR-1 @PN-1 @PN-2 @hands
  Scenario: The panel shows over a full-screen app
    Given a terminal in full screen (⌃⌘F)
    When I press Caps Lock
    Then the panel shows over the terminal
    And there is no Space animation
    And the terminal stays in full screen

  @PR-2 @PN-2 @VH-10 @hands
  Scenario: Typing and the edit keys work over a full-screen app
    Given the panel shown over a terminal in full screen, as in PR-1
    When I type a phrase and press ⌘A, ⌘C, ⌘V and ⌘Z
    Then each works as on a desktop Space
    When I right-click a selection
    Then the macOS context menu opens
    When I run ⌘K with Shorten, then open ⌘L
    Then the edit arrives and the Library opens, as on a desktop Space

  @PR-3 @PN-2 @hands
  Scenario: Dictation lands in the editor
    Given the panel shown over a terminal in full screen, as in PR-1
    And MacWhisper is installed
    When I dictate into the editor with a short prompt
    Then the text lands in the editor
    And the recording bubble shows under the prompt
    When I dictate with a prompt taller than the panel
    Then the text lands in the editor
    And the bubble is out of sight (panel.md, Not supported)

  @PR-4 @PN-4 @hands
  Scenario: Hiding gives the keyboard back to the app underneath
    Given the panel shown over a terminal in full screen, as in PR-1
    When I press Esc
    Then the terminal has the keyboard on its full-screen Space
    When I show the panel again, press ⌘↵, then ⌘V
    Then ⌘V pastes the prompt into the terminal

  @PR-5 @PN-5 @hands
  Scenario: A click elsewhere hides the panel
    Given a draft in the panel
    When I show the panel and click in another app's window, then on the desktop
    Then the panel hides on the first click
    And focus is in the clicked app
    When I press Caps Lock
    Then the panel shows with the draft

  @PR-6 @PN-3 @hands
  Scenario: The panel is out of the window lists
    When I show the panel on a desktop Space and open Mission Control
    Then the panel is not in it
    When I open App Exposé
    Then the panel is not in it
    When I hold ⌘Tab
    Then Sushi is not listed

  @PR-7 @PN-1 @PN-4 @hands @second-display
  Scenario: A second display and Stage Manager
    Given a second display
    When I show the panel on each display
    Then it shows on the display I work on
    When I turn Stage Manager on and show the panel over a stage
    Then it shows over the stage
    And hiding it gives the keyboard back to the stage's window

  @PR-8 @PN-6 @PN-2 @hands
  Scenario: Ollama starts behind the panel
    Given the Ollama app and the model are installed
    And Ollama is quit from its menu bar icon
    When I show the panel over a terminal, type a phrase and run ⌘K with Shorten
    Then Ollama's menu bar icon appears and no Ollama window opens
    And the panel stays open with the keyboard and shows the diff
    And the menu bar keeps the terminal's menus

  @PR-9 @PN-2 @PN-5 @PN-8 @LF-22 @hands @affected-mac @writing-tools
  Scenario: The Writing Tools sheet on the Mac where the panel hid
    Given the Mac where the panel hid after ⌘A (SUSI-7), with Writing Tools on
    And *Log panel activity* is on in Settings ▸ About
    When I show the panel with a draft, press ⌘A and wait 2 s
    Then all is selected and the panel stays open
    When I press Caps Lock twice
    Then the panel hides and shows without flicker
    When I select all again, choose **Writing Tools → Summary** and wait for its sheet
    Then the Summary sheet opens over the panel and the panel stays
    When I press Caps Lock twice
    Then both hide, and both show again with the sheet in front
    When I choose **Show Sushi** in the menu bar menu
    Then the sheet stays in front
    When I click another app's window
    Then both hide and focus stays in the clicked app
    When I press Caps Lock
    Then both come back with the sheet in front
    When I close the sheet and type
    Then the typing lands in the editor
    When I click another app's window
    Then the panel hides
    When I choose **Diagnostics on · Show log** in the menu bar menu
    Then the log has `focus kept`
    And for every other step where the panel hid, its `focus lost` record names what took the keyboard

  @PR-10 @PN-4 @PN-5 @PN-8 @hands
  Scenario: A sheet of the panel stays, hides and comes back with it
    Given *Log panel activity* is on in Settings ▸ About, so a failure leaves a log
    And Sushi is quit and started with a test sheet, which attaches to the panel on its first show:
      """
      osascript -e 'quit app "Sushi"'
      open -g --env SUSHI_TEST_SHEET=1 <path>/Sushi.app --args --hidden
      """
    When I press Caps Lock
    Then the sheet shows over the panel and the panel stays
    When I press Caps Lock
    Then the panel hides with the sheet, and the app underneath has the keyboard
    When I press Caps Lock again
    Then both show again and stay, without a flicker, the sheet in front with the keyboard
    When I press Caps Lock twice more
    Then both hide and show again the same way
    When I choose **Show Sushi** in the menu bar menu
    Then the sheet stays in front with the keyboard
    When I click another app's window
    Then both hide and focus stays in the clicked app
    When I press Caps Lock
    Then the sheet is back in front
    When I press **OK** and type
    Then the typing lands in the editor
    When I click another app's window
    Then the panel hides
    When I press Caps Lock, then Esc
    Then the keyboard is back in the app underneath
    When I run PR-5
    Then it passes

  @PR-11 @PN-9 @PN-10 @ST-1 @ST-2 @ST-3 @hands
  Scenario: The panel and the settings window share the keyboard
    When I show the panel over a terminal and press ⌘,
    Then the panel hides and does not come back
    And Settings opens on the same Space and takes the keyboard, at the pane it was left on
    When I press Caps Lock, then Esc, and type into a field of Settings
    Then Caps Lock shows the panel over Settings
    And Esc gives the keyboard back to Settings: the typing lands in the field
    When I press Caps Lock and click inside Settings
    Then the panel hides and the field I clicked has the keyboard
    When I press Caps Lock and click the terminal
    Then the panel hides with focus in the terminal
    When I open Settings from **Settings…** in the menu bar menu, open About and click **Report a problem…**
    Then the report's window opens in front of Settings at *What went wrong?*
    When I press Esc
    Then the report's window closes and the keyboard is back in Settings
    When I put Settings behind another app and choose **About Sushi** in the menu bar menu
    Then the same window comes forward at About, never a second one
    When I press ⌘W
    Then Settings hides and the panel does not show
    And the terminal is active and takes typing

  @PR-12 @PN-7 @ST-17 @hands
  Scenario: The menu names the key in effect, and says when Caps Lock is taken
    When I open the menu bar menu
    Then **Show Sushi** shows ⇪ as its shortcut and no row follows it
    When I choose **Keyboard shortcut** in Settings ▸ Keyboard, record ⌥Space and open the menu again
    Then **Show Sushi** shows ⌥Space
    When I choose **Caps Lock** again
    And I turn on “Use the Caps Lock key to switch to and from ABC” in System Settings ▸ Keyboard ▸ Input Sources
    And I quit Sushi, start it and open the menu
    Then **Show Sushi** shows ⌥Space, the backup, and **Caps Lock unavailable…** follows it
    When I choose **Caps Lock unavailable…**
    Then Settings opens at Keyboard and leads with *Caps Lock is used to switch input sources.*
    And it says to use ⌥Space and offers **Open macOS keyboard settings…**
    When I turn the macOS option off and click in Settings
    Then Caps Lock shows Sushi again and the row leaves the menu
    And `F18` showed nowhere on the way

  @PR-16 @PN-11 @hands
  Scenario: Starting Sushi stays quiet
    When I quit Sushi from its menu and open it from Applications
    Then the icon comes back to the menu bar and no panel shows
    And focus stays where it was
    When I press Caps Lock twice
    Then the panel shows and hides
    When I open Sushi from Applications again, while it runs
    Then the panel shows

  @PR-17 @PN-1 @PN-4 @VH-5 @LF-12 @hands @smoke
  Scenario: The two-minute basics after an upgrade
    Given the model in use answers (Ollama runs, or a hosted provider is connected) and the Library holds my prompts
    When I look at the menu bar
    Then the Sushi icon is there
    When I press Caps Lock twice
    Then the panel shows and hides
    When I show the panel over another app, type a short phrase and run ⌘K with Shorten
    Then the diff of the edit shows in the editor
    When I press ⌘↵, then ⌘V
    Then the panel hides and the result is pasted into the app underneath
    When I show the panel and press ⌘L
    Then the Library lists my prompts

  @PR-18 @PN-11 @hands @fresh-account
  Scenario: The first start on a Mac shows the panel
    Given a macOS account where Sushi never ran: no `~/Library/Application Support/me.octopot.sushi`
    When I open Sushi from Applications
    Then the icon comes to the menu bar and the panel shows
    When I quit Sushi and open it again
    Then no panel shows

  @PR-19 @PN-7 @MD-15 @hands
  Scenario: The menu bar menu holds its rows
    Given the key chosen is in effect, no recording runs, `diagnostics.json` is off and `model.json` is valid
    When I open the menu bar menu
    Then its rows are **Show Sushi**, **Model · <model name>** ▸, **Settings…** (⌘,), **Report a problem…**, **About Sushi** and **Quit Sushi** (⌘Q)
    And a separator follows **Model** and another precedes **About Sushi**
    When I open **Model**
    Then it lists Ollama and each connected provider, with a check mark on the one in use
    And below a separator it has **Model settings…** and nothing else
    When I choose another row of **Model** and open the menu again
    Then the title of **Model** names that row's model and the check mark moved
