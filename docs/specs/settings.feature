# Acceptance scenarios of settings.md: what needs the real settings window in a real macOS
# session. How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: The settings window
  The window's page, its saves and its files are proven by the tests and by
  tests/stage/settings.sh. Left for a real session: the keys macOS delivers, the native
  sheets and VoiceOver.

  Background:
    Given the build under test runs and its settings window is open (⌘, in the panel)

  @PR-13 @ST-16 @ST-18 @hands
  Scenario: Recording the key that shows Sushi
    Given another app holds a global shortcut of its own, Raycast for example
    When I choose **Keyboard shortcut** in Settings ▸ Keyboard, click **Change…** and press ⌃⇧Space
    Then the panel neither shows nor hides while recording
    When I record ⌥Space
    Then the combination is taken when its keys are released
    When I click **Change…** again, hold ⌥Space for two seconds and release it
    Then ⌥Space is recorded and the panel does not show
    When I press ⌥Space once more
    Then the panel shows once
    When I click **Change…** and click another app
    Then the recording ends and ⌥Space shows Sushi again
    When I click **Change…** and press the combination the other app holds
    Then that app answers, and nothing is recorded or saved
    And ⌥Space still shows Sushi
    When I choose **Caps Lock**, click **Change…** and press Caps Lock
    Then nothing toggles
    When I press the combination the other app holds, as the backup
    Then that app answers, nothing is saved, and Caps Lock still shows Sushi
    When I click **Change…** and record ⌃⇧Space
    Then ⌃⇧Space is saved as the backup while Caps Lock keeps showing Sushi

  @PR-26 @ST-27 @hands
  Scenario: The library folder and its picker
    Given a library folder with a long path, several folders deep
    When I open Settings ▸ Library
    Then the path wraps after a slash and never inside a name
    When I click **Choose folder…**
    Then the macOS folder picker opens as a sheet of the settings window
    When I click **Cancel**
    Then the folder stays as it was and `library-path.txt` is not written
    When I click **Show library in Finder**
    Then Finder shows the folder

  @PR-27 @ST-4 @hands
  Scenario: VoiceOver and a session without the mouse
    Given VoiceOver is on (⌘F5)
    When I go through the five panes with ⌘1 to ⌘5 and move through each with the keyboard
    Then every control can be reached without the mouse
    And VoiceOver reads a name for every control
    When I press Esc on a control that is doing something, such as the key recorder
    Then it ends what the control was doing and deletes or resets nothing
