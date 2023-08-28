# Acceptance scenarios of build-info.md: what needs the installed app and the real clipboard.
# How they are written, tagged and run: panel.md, "Regression scenarios".

Feature: Build info
  The block and its fields are proven by the Rust tests and by release.mjs package on every
  release. Left for a real session: the clipboard, and the command while Sushi runs.

  @PR-25 @BI-3 @BI-4 @BI-5 @BI-6 @hands
  Scenario: Copy build info and sushi version say the same
    Given Sushi runs from `/Applications/Sushi.app` and the panel is hidden
    When I click **Copy build info** in Settings ▸ About and paste into a text file
    Then the button says *Copied*
    And the pasted text is the build info block
    When I run the command in a terminal:
      """
      /Applications/Sushi.app/Contents/MacOS/sushi version
      """
    Then it prints the same text as the pasted block, line for line
    And the running Sushi does not show its panel
    When I read the `build date` and `git hash` lines of a build installed from the cask
    Then the date is the day the release tag was made
    And the hash is the tag's commit, without `-dirty`
