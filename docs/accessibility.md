# Accessibility (#21)

What is checked automatically, what was found and fixed (two passes: 2026-10-18 and the production-hardening audit of
2026-10-22), and what still needs a person with a screen reader. Nothing here is a claim about a check nobody ran: each
section says who ran what. Agents cannot run VoiceOver, so every screen-reader row is marked **Caroline to verify**.

## Automated checks (run on every CI build)

axe-core (`@axe-core/playwright`, dev dependency only) runs against WCAG 2.0/2.1/2.2 A and AA plus axe's best-practice rules
through `expectAccessible` (`tests/e2e/helpers/a11y.ts`). It fails on **any** violation, not only serious or critical ones.
Each state is reached the way a person reaches it, against the real e2e database, at **both viewports** (phone 390×844,
WebKit iPhone 15; desktop 1440×1000, Chromium), for the specs tagged `@device`.

| Area                                 | Where                                                                           | States checked                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, Access denied               | `a11y.spec.ts`                                                                  | idle, wrong-password error; the screen                                                                                                                                                                                                          |
| Account screens                      | `auth-screens.spec.ts`                                                          | the account screens, locked verify, forgot-password confirmation                                                                                                                                                                                |
| Dashboard                            | `a11y.spec.ts`, `nav-sign-out.spec.ts`                                          | upcoming, quick view, past and archive, recently deleted with Undo, remove dialog, error chip, retry sheet, Undo toast, loading, load error                                                                                                     |
| Dashboard hero Add item, ⋯ trip menu | `a11y-ledger.spec.ts`                                                           | inline Add item open; menu open                                                                                                                                                                                                                 |
| Create / copy                        | `a11y.spec.ts`, `multi-stop.spec.ts`, `weather.spec.ts`                         | step 1 (empty, results, no matches, confirmed with the theme picker), discard prompt, stops step, shape step with weather                                                                                                                       |
| Start from a saved list              | `a11y-ledger.spec.ts`                                                           | the step, a list previewed and chosen                                                                                                                                                                                                           |
| Trip screen                          | `a11y.spec.ts`, `multi-stop.spec.ts`, `weather.spec.ts`, `stamp-labels.spec.ts` | the screen, filter, Ready, not available, edit item, remove confirm, add Bathroom item, preferences, theme sheet, weather panel and review sheet, toiletry bag prompts, an unsaved row, edit route sheet, Stamp label sheet (automatic, custom) |
| Packing inline Add item              | `a11y-ledger.spec.ts`                                                           | open                                                                                                                                                                                                                                            |
| Save as a list                       | `a11y-ledger.spec.ts`                                                           | the sheet, the duplicate prompt                                                                                                                                                                                                                 |
| Review your bag                      | `a11y.spec.ts`                                                                  | items left, Ready, Ready revoked                                                                                                                                                                                                                |
| Staples                              | `a11y.spec.ts`, `a11y-ledger.spec.ts`                                           | list, editor, duplicate error, the Staples \| Saved lists tabs                                                                                                                                                                                  |
| Saved lists                          | `a11y-ledger.spec.ts`                                                           | empty, with lists, rename sheet, delete confirm, the editor, add and edit item sheets, the Undo toast, "not available"                                                                                                                          |
| Settings                             | `a11y.spec.ts`                                                                  | idle, error state                                                                                                                                                                                                                               |
| All four themes                      | `theme-matrix.spec.ts`                                                          | dashboard, packing screen and Settings in Base, Deep Ocean, Terracotta and Ink Violet at 1280 (and Deep Ocean at 390), with rendered contrast                                                                                                   |

Also asserted (not axe):

- **Keyboard and focus.** The skip link is the first Tab stop and moves focus to the main content. A dialog traps Tab, keeps the
  page behind it unreachable, closes on Escape and returns focus to what opened it (`a11y.spec.ts`, Edit preferences).
  `expectDialogKeyboard` runs the same check, with Tab ×14 and Shift+Tab ×14, on every dialog added since: Rename list,
  Delete list, Add and Edit list item, Save as a list, Stamp label (`a11y-ledger.spec.ts`). These run on desktop Chromium:
  Safari only tabs to buttons and links when the person turns on full keyboard access, which is a browser setting, so a
  Tab-order test on WebKit would test that setting, not the app. The ⋯ menu's arrow-key, Home/End and Escape behaviour is
  covered by `MoreMenu.test.tsx`; the radio-group keyboard behaviour of the theme picker by its unit test.
- **Live regions.** `Toast.tsx` has a polite `role="status"` region and a separate assertive `role="alert"` region from the
  start (`Toast.test.tsx` covers timing and pausing on hover and focus). The new notices ("Renamed to …", the list Undo toast,
  "Stamp updated.") are asserted to appear in the polite region (`a11y-ledger.spec.ts`).
- **Reflow and text size.** Nothing scrolls sideways at 320 px on the dashboard, trip screen, Settings, the Saved lists page and
  editor, and the Save as a list and Stamp label sheets; 200% text keeps everything reachable; the fixed bottom navigation
  never covers the last content on a short phone. With the OS reduced-motion setting on, no animation is running.
- **Colour contrast.** `src/app/tokens.test.ts` reads the real role tokens for all four themes and asserts the whole #139 §6
  table (text 4.5:1, UI and graphics 3:1, including hover, focus, completed, the stamps and the header). axe's colour-contrast
  rule measures the rendered pairs in every state above. Disabled controls are exempt, and are never the only cue.

## What the audits found and fixed

| Finding                                                                                                                                                                                                                                                                                                                                                                               | WCAG                  | Fix                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The brand link's name did not contain its visible text.                                                                                                                                                                                                                                                                                                                               | 2.5.3 Label in Name   | The name starts with the visible text.                                                                                                                                                                  |
| Every packing row's Edit button had an accessible name that did not contain its visible text.                                                                                                                                                                                                                                                                                         | 2.5.3                 | The row is named by its content, which already says "tap to edit".                                                                                                                                      |
| The packed count on a row ("1/4") was hidden from assistive technology.                                                                                                                                                                                                                                                                                                               | 1.3.1 / 4.1.2         | It is an image-role text named "1 of 4 packed".                                                                                                                                                         |
| "Toiletry bag is in the suitcase" help text was low contrast on its card.                                                                                                                                                                                                                                                                                                             | 1.4.3                 | It uses the ink colour on that card.                                                                                                                                                                    |
| The quick view's scrollable list could not be reached from the keyboard.                                                                                                                                                                                                                                                                                                              | 2.1.1                 | It is a labelled, focusable region ("Quick view items").                                                                                                                                                |
| "Review your bag" jumped from a level 1 heading to level 3 section headings.                                                                                                                                                                                                                                                                                                          | 1.3.1                 | The sections are level 2 headings and look the same.                                                                                                                                                    |
| The dashboard's trip tabs overflowed at 320 px with larger text.                                                                                                                                                                                                                                                                                                                      | 1.4.4 / 1.4.10        | The tabs wrap.                                                                                                                                                                                          |
| **(2026-10-22)** Focus did not return to the opener when a dialog containing an `autoFocus` field closed (Rename list, Add and Edit list item, Save as a list, and any later sheet that autofocuses). It landed on the page body. `ModalSheet` read the focused element after the autofocused field had already taken focus, so it "restored" focus to a field that was then removed. | 2.4.3 Focus Order     | `ModalSheet` remembers the last control focused outside any dialog and uses it when focus is already inside one. Unit test fails without the fix; `expectDialogKeyboard` asserts it on each new dialog. |
| **(2026-10-22)** The Saved lists editor's "That list isn't available" and "Couldn't load this list" states had no level 1 heading.                                                                                                                                                                                                                                                    | 1.3.1 / best practice | The bold line is now an `h1` with the same look (`.empty-state-title`).                                                                                                                                 |

No visual change in this pass: both fixes are behaviour or markup only, so there are no before/after screenshots to approve.
For the first pass's visible changes the e2e run saves `after` screenshots (artifact names `<project>-a11y-*.png`).

## Colour contrast

The role tokens (Field Ledger, #139) define four themes. `tokens.test.ts` asserts the contrast table from the real tokens on
every CI run, and axe measures the rendered pairs. Text over illustrations is decorative and exempt; the trip picture is
off in the current design. If a token is changed and a pair falls under 4.5:1 for text or 3:1 for UI, the unit test names the
pair and the theme. Not yet covered by axe: the Saved lists screens and sheets in the three non-Base themes (they use the same
tokens as the screens that are).

## Deferred, and why

- **Screen-reader passes** need a person and a device (below).
- **The combobox in a real screen reader.** The ARIA pattern (expanded state, active option, result count) is unit-tested and
  axe-clean; only a person with VoiceOver can confirm how it is read.
- **Large system text size on a real phone.** 200% browser text and 320 px reflow are automated; the iOS "larger text" setting is
  a manual row below.

## Manual screen-reader and device checklist

**Not yet run: Caroline to verify.** VoiceOver on iOS Safari and macOS needs a person and a device; no agent can do it, so this
file does not claim a result. Run each row, tick it, and record the date below. Every row is one thing to listen for.

### Original flows

- [ ] **Create a trip** (Caroline to verify): the destination combobox announces its result count; choosing a result announces
      the confirmed destination; the theme radio group announces its label and state; Continue explains why it is unavailable.
- [ ] **Packing** (Caroline to verify): each row announces its name and "tap to edit"; the stepper announces "1 of 4 packed" and
      each change is announced once; checking a row announces its new state.
- [ ] **Toiletry gate** (Caroline to verify): the prompt opens focused on "Not yet"; the bag state card is announced; confirming
      announces the result.
- [ ] **Review and Ready** (Caroline to verify): the disabled "I'm ready to go" reads its reason; Ready is announced once; a
      revocation toast is announced politely with its reason.
- [ ] **Save states** (Caroline to verify): the top-bar chip announces Saving…, Saved and the error state; the retry sheet is
      announced as a dialog and focus returns to the chip.

### Added since (Field Ledger, saved lists, stamps)

- [ ] **Themes** (Caroline to verify): on Settings the Theme radio group announces "Theme", each option's name and which is
      selected, and the arrow keys move between options; "Current theme: …" shows the change when you reach it.
- [ ] **⋯ trip menu** (Caroline to verify): the button reads "More actions for <trip>" and its expanded state; the menu is announced
      as a menu; the arrow keys move between items; Escape returns to the button.
- [ ] **Add item** (Caroline to verify): the "＋ Add item" toggle reads its expanded state; the form fields are named (Item name,
      Category, Needed); "<item> added to <category>" is announced once.
- [ ] **Saved lists** (Caroline to verify): the Staples \| Saved lists switcher announces the current page; each list card reads as
      an article with its name, count and last change; Rename and Delete name the list ("Rename Beach week"); the delete
      confirm reads "This can't be undone."; after a rename or a remove the toast is announced, with Undo reachable.
- [ ] **Save as a list** (Caroline to verify): the name field is announced with its hint; the checklist groups are announced as
      groups; "N of M items" updates politely; the duplicate prompt reads each group's options with no default chosen.
- [ ] **Start from a saved list** (Caroline to verify): the options read as one radio group "Starting point" with "No saved list"
      first; Preview items names the list; choosing one announces that it replaces your staples.
- [ ] **Stamp label** (Caroline to verify): the stamp reads as one image ("PRT, FRA route stamps" or "ABC, Lisbon, departure stamp");
      the sheet's blocks read "Stamp 1, automatic"; the mode radios read their state; an error is announced when the field loses
      focus; the toast reads "Stamp updated." once.
- [ ] **Focus after a dialog** (Caroline to verify): after closing Rename list, Save as a list or Stamp label with Escape, VoiceOver
      lands back on the button that opened it, and not at the top of the page.

### Display and input

- [ ] **Larger system text** (Caroline to verify): at the largest iOS text size, no screen clips text or hides a button, and the
      bottom nav never covers the last item.
- [ ] **Reduced motion** (Caroline to verify): with Reduce Motion on, no spinner animation or fade remains and the status still reads.
- [ ] **Full keyboard access in Safari** (Caroline to verify): with Full Keyboard Access on, Tab reaches buttons and links on the
      dashboard, the packing screen and a dialog, and each dialog keeps focus inside until closed.

| Date | Tester | Device and browser | Rows passed | Notes |
| ---- | ------ | ------------------ | ----------- | ----- |
|      |        |                    |             |       |
