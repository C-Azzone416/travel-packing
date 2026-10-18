# Accessibility (#21)

What is checked automatically, what was found and fixed, and what still needs a person with a screen reader. Nothing
here is a claim about a check nobody ran: the sections say who ran what.

## Automated checks (run on every CI build)

`tests/e2e/a11y.spec.ts` runs axe-core (`@axe-core/playwright`, dev dependency only) against WCAG 2.0/2.1/2.2 A and AA
plus axe's best-practice rules, at **both viewports** (phone 390×844 and desktop 1440×1000). The helper
(`tests/e2e/helpers/a11y.ts`) fails on **any** violation, not only serious or critical ones. Each state is reached the
way a person reaches it, against the real e2e database.

| Screen          | States checked                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in         | idle, wrong-password error                                                                                                                                                                                                            |
| Access denied   | the screen                                                                                                                                                                                                                            |
| Dashboard       | upcoming, quick view open, past and archive, recently deleted with an Undo row, remove dialog, error chip, retry sheet, Undo toast                                                                                                    |
| Create / copy   | step 1 empty, results list, no matches, confirmed with the theme picker, discard prompt, step 2                                                                                                                                       |
| Trip screen     | the screen, Still to pack filter, a Ready trip, a trip that does not exist, edit item, remove confirm, add Bathroom item, preferences, theme sheet, weather dialog, toiletry bag prompt and "ready to place", a row that did not save |
| Review your bag | with items left, on a Ready trip                                                                                                                                                                                                      |
| Settings        | idle, in the error state                                                                                                                                                                                                              |

Also asserted (not axe): the fixed bottom navigation never covers the last content on a short phone; with the OS reduced-motion setting on, no animation is running; the skip link is the first Tab stop and moves focus to the main content; a dialog traps Tab and
leaves the page behind it unreachable, closes on Escape and returns focus to what opened it; nothing scrolls sideways at
320 px on the dashboard, trip screen and settings; 200% text keeps everything reachable with no sideways scroll.

Unit tests cover the same focus behaviour for `ModalSheet`, the combobox pattern in the location picker, the
radio-group keyboard behaviour of the theme picker, and the live regions that announce counts and changes.

**Result on the head that merged this:** zero axe violations of any impact in all of the states above.

## What the audit found and fixed

| Finding                                                                                                                                                       | WCAG                | Fix                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The brand link's name ("Go to trips") did not contain its visible text.                                                                                       | 2.5.3 Label in Name | The name now starts with the visible text ("Carrywell, Caroline's packing companion: go to trips"), and the two lines of visible text are separated by a space so they read as words. |
| Every packing row's Edit button had an accessible name ("Edit Everyday tops") that did not contain its visible text ("Everyday tops Clothing · tap to edit"). | 2.5.3               | The row is named by its content, which already says "tap to edit". (This changes what a screen reader announces for the button; the visible design is unchanged.)                     |
| The packed count on a row ("1/4") was hidden from assistive technology, so it was only ever announced after a change.                                         | 1.3.1 / 4.1.2       | It is now an image-role text with the name "1 of 4 packed".                                                                                                                           |
| "Toiletry bag is in the suitcase" help text was low contrast on the green card.                                                                               | 1.4.3               | It uses the ink colour on that card. (A visible, if small, colour change: design to confirm.)                                                                                         |
| The quick view's scrollable list could not be reached from the keyboard.                                                                                      | 2.1.1               | It is a labelled, focusable region ("Quick view items").                                                                                                                              |
| "Review your bag" jumped from a level 1 heading to level 3 section headings.                                                                                  | 1.3.1               | The sections are level 2 headings and look the same.                                                                                                                                  |
| The dashboard's trip tabs overflowed at 320 px with larger text.                                                                                              | 1.4.4 / 1.4.10      | The tabs wrap.                                                                                                                                                                        |

## Before and after

For each visible change the e2e run saves an **after** screenshot at both viewports (artifact names
`<project>-a11y-*.png`: pack-last-badge, editor-legend, bag-card-in-suitcase, error-chip). The **before** is the same
screen in the previous develop run's artifacts (`*-trip.png`, `*-trip-editor.png`, and the Settings error shots).

## Keyboard walkthrough

Covered by the e2e above and by the earlier screen specs: every control on the screens listed is reachable and operable
with the keyboard; focus rings are the shared 3 px teal outline with a 2 px offset; hit areas are at least 44 px
(asserted per screen); dialogs open on a sensible first control, trap focus, restore it on close, and Escape closes
every dialog that is not a destructive confirm backdrop press.

## Deferred

- **Manual screen-reader and large-system-text passes** need a person and a device (see below).
- **Combobox in a real screen reader**: the ARIA pattern (expanded state, active option, result count) is unit-tested
  and axe-clean, but only a person with VoiceOver can confirm how it is read.

## Colour contrast

Axe's colour-contrast rule runs in every state listed above, so every text/background pair that the screens actually
render is measured, including the muted text token and text on the seafoam cards. The one failure it found is in the
table above. Pairs that only appear in illustrations are decorative and exempt.

## Manual screen-reader checklist (to be run by a person)

**Not yet run.** VoiceOver on iOS Safari and macOS needs a person and a device; no agent can do it, so this file does
not claim a result. Run each item and record pass/fail and the date below.

- [ ] Create a trip: the destination combobox announces its result count; choosing a result announces the confirmed
      destination; the theme radio group announces its label and state; Continue explains why it is unavailable.
- [ ] Packing: each row announces its name and "tap to edit"; the stepper announces "1 of 4 packed" and each change is
      announced once; checking a row announces its new state.
- [ ] Toiletry gate: the prompt opens focused on "Not yet"; the bag state card is announced; confirming announces the
      result.
- [ ] Review and Ready: the disabled "I'm ready to go" reads its reason; Ready is announced once; a revocation toast is
      announced politely with its reason.
- [ ] Save states: the top-bar chip announces Saving…, Saved and the error state; the retry sheet is announced as a
      dialog and focus returns to the chip.

| Date | Tester | Device and browser | Items passed | Notes |
| ---- | ------ | ------------------ | ------------ | ----- |
|      |        |                    |              |       |
