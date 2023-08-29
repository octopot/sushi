# Acceptance scenarios of report.md: what needs the real windows, the menu, dictation, Finder and
# the clipboard. How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: Reporting a problem
  The flow, the questions, the snapshot and the report's text are proven by the tests with
  the system calls replaced. Left for a real session: the window among other apps and with the
  panel, the menu rows, dictation into the description, the recording of real keys, Finder and
  the clipboard.

  @PR-24 @RP-1 @RP-2 @RP-3 @RP-4 @RP-5 @RP-8 @PN-9 @PN-10 @hands
  Scenario: A report in its own window, by hand
    Given the build under test runs, and a hosted provider is connected and in use
    And a dictation tool is at hand, macOS Dictation or MacWhisper
    When I choose **Report a problem…** in the menu bar menu
    Then a window opens at *What went wrong?* and has the keyboard
    When I dictate the description
    Then my words are in the field as dictated
    When I click another app's window, then open Mission Control
    Then the report's window stayed open, and Mission Control shows it
    When I drag the window by its title or an empty part of it
    Then it moves
    When I press Caps Lock, type in the panel and press Esc
    Then the panel showed over the report's window, and Esc gives the keyboard back to the description
    When I press ⌘W and choose **Report a problem…** in the menu bar menu again
    Then the window hides, and comes back with my description as I left it
    When I press **Next**
    Then Sushi says the description would go to the provider, and offers **Ask <Name>** and **Use standard questions**
    When I choose **Use standard questions**
    Then the three standard questions show, and nothing was sent
    When I answer the first question, leave the others empty and press **Next**
    Then *Reproduce it now?* says what a recording holds and that it never records my text
    When I choose **Start recording**
    Then the window stays open at *Recording…*, and the menu bar menu has **Finish recording**
    When I press Caps Lock
    Then the top of the panel says `Recording for a problem report · Finish recording`
    When I press ⌘K and Esc in the panel, hide it, then choose **Finish recording** in the menu bar menu
    Then the report's window comes forward with the report: my description, my answer and the recording listed with its size
    When I press ⌘S
    Then the window hides, and Finder shows a new folder in `~/Library/Logs/me.octopot.sushi/Reports/` with `report.txt` and `report-recording.log`
    And the recording lists the shows, the hides and ⌘K, and none of my text
    When I choose **Report a problem…** in the menu bar menu
    Then the window comes back with the report as it was
    When I click the checkbox of the recording and press ⌘↵, in a window opened over a text editor
    Then the report's window closes, though the click took the focus from the report's text, and the text editor has the keyboard
    When I press ⌘V
    Then the pasted text is the report as the window showed it
    When I choose **Report a problem…** again and press Esc
    Then the report was still there, the window closes, and the next **Report a problem…** starts from an empty description
