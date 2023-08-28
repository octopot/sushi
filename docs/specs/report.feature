# Acceptance scenarios of report.md: what needs the real panel, the menu, dictation, Finder and
# the clipboard. How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: Reporting a problem
  The flow, the questions, the snapshot and the report's text are proven by the tests with
  the system calls replaced. Left for a real session: the menu rows, dictation into the
  description, the recording of real keys, Finder and the clipboard.

  @PR-24 @RP-1 @RP-2 @RP-3 @RP-4 @RP-5 @RP-8 @hands
  Scenario: A report from the menu, by hand
    Given the build under test runs, and a hosted provider is connected and in use
    And a dictation tool is at hand, macOS Dictation or MacWhisper
    When I choose **Report a problem…** in the menu bar menu
    Then the panel shows at *What went wrong?*
    When I dictate the description and press **Next**
    Then my words are in the field as dictated
    And Sushi says the description would go to the provider, and offers **Ask <Name>** and **Use standard questions**
    When I choose **Use standard questions**
    Then the three standard questions show, and nothing was sent
    When I answer the first question, leave the others empty and press **Next**
    Then *Reproduce it now?* says what a recording holds and that it never records my text
    When I choose **Start recording**
    Then the flow steps aside and the top of the panel says `Recording for a problem report · Finish recording`
    And the menu bar menu has **Finish recording**
    When I press Caps Lock twice and ⌘K, then choose **Finish recording** in the menu bar menu
    Then the panel shows the report, with my description, my answer and the recording listed with its size
    When I click **Save…**
    Then Finder shows a new folder in `~/Library/Logs/me.octopot.sushi/Reports/` with `report.txt` and `report-recording.log`
    And the recording lists the shows, the hides and ⌘K, and none of my text
    When I show the panel, click the checkbox of the recording and press ⌘↵
    Then the panel says *Copied.*, though the click took the focus from the report's text
    When I paste into a text file
    Then the pasted text is the report as the panel shows it
