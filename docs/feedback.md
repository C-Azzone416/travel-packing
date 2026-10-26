# Feedback to the developer (#127)

People who have an invitation can send the developer a note, and on test builds a screenshot, from inside the app. This page is for
the people who run it: what is captured, what never is, how to set it up, and how to check it on a Preview. Developer setup (package
access, the fake service used in tests) is in [framebriar.md](framebriar.md).

Nothing in this repository holds a token, an invitation or a credential. `<INVITATION>` below is a placeholder and must be shared
privately. The app id and origins are public configuration and are written exactly.

## What is captured, and what never is

A report holds what the person typed and a few approved codes. The review sheet shows the notes and the screenshot (if any), and
lists the rest under "Also sent".

| Sent                                                                                                               | Never sent or captured                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| The notes the person wrote (2,000 characters at most)                                                              | Passwords, sign-in codes, invitations, tokens                                        |
| A screenshot of the screen, **only on Preview, local and test builds**, ticked by default and removable per report | Email addresses; trip names, places, dates or ids in the report's own fields         |
| The screen as a code: `trips`, `new-trip`, `trip`, `review`, `staples` or `other`                                  | The address of the page (it contains a trip id)                                      |
| A viewport class (`phone`, `tablet`, `desktop`), the input kind, the app version, the capture time                 | Anything from Settings or the sign-in and account screens: nothing is captured there |

- A screenshot shows what is on screen, including trip names and places. The sheet says so next to the tick box. **Production never
  captures screenshots:** the capture code is not in a production build at all (see "Screenshots" in [framebriar.md](framebriar.md)).
- Telemetry is off. Nothing here collects performance or diagnostic data; adding it later needs its own decision and a disclosure line
  in Settings.
- Capture is blocked on Settings and on the sign-in, sign-up, verify, forgot-password, reset-password, finish-setup and
  access-denied screens, in the Feedback button and in the capture code itself.

## Owner setup (once)

These steps belong to the owner of the Framebriar service and of this repository; the app's developers cannot do them.

1. **Register the app:** `framebriar-admin games add travel-packing` (builds: any). Check status first; do not add a duplicate if it
   already exists.
2. **Allow only the exact origins** the app uses. Each must be in both Framebriar's registry and Azure platform CORS:
   `framebriar-admin origins add http://localhost:3000 --azure-cors`,
   `framebriar-admin origins add https://travel-packing-preview.vercel.app --azure-cors`, and
   `framebriar-admin origins add https://packed-smart.vercel.app --azure-cors`. Old per-deployment Preview addresses stay out.
3. **Install the SDK:** the repository pins the exact private SDK distributable as
   `vendor/framebriar/framebriar-0.4.1.tgz`. A normal `npm ci` needs no package token or registry access; provenance and the update
   procedure are in [framebriar.md](framebriar.md).
4. **Let a person connect:** issue an invitation for the app, for example
   `framebriar-admin invite travel-packing --days 7 --uses 1`, and give `<INVITATION>` to that person privately. An invitation works once
   and expires; the connection it creates lasts 30 days.

## Connecting and disconnecting (for the person using the app)

- **Connect:** Settings, "Send feedback to the developer". Paste the invitation into the field and press Connect. The field empties
  at once and the invitation is not stored anywhere. When it works the section says "Connected" and until when. The Feedback button
  in the header then turns on.
- **Send a report:** press Feedback, write what happened, untick the screenshot if it is offered and you don't want it, and press Send.
  "Saved on this device" means the report is kept here and will go out when the device is online; "Received" means the developer's
  service has it. Reports waiting to send are kept across reloads, offline periods and even a disconnect.
- **When access ends:** a notice under the header says the access expired or needs a new invitation (the same notice, with a button
  to Settings, appears on every screen except Settings). Reports saved meanwhile stay on the device until a new invitation is added.
- **Disconnect:** Settings, "Disconnect", then confirm. Feedback access is removed from the device and, when the service can be
  reached, ended on the service. Reports that have not been sent stay on the device.

## Preview delivery check (manual, with a real invitation)

The automated tests use a fake service and never call the real one, so a real delivery is checked by hand once per deployment that
changes feedback. Use a Preview, not Production.

1. The owner issues one invitation for `travel-packing` (step 4 above) and gives it to the person doing the check.
2. Open the Preview at its stable address (`https://travel-packing-preview.vercel.app`) and sign in. On Settings, paste the
   invitation and press Connect.
   Expect "Connected", an expiry date about 30 days away, and the field empty.
3. On the Trips screen press Feedback. Expect the sheet with the screenshot ticked and a thumbnail. Write "Preview delivery check",
   press Send. Expect "Saved on this device", and then, within a minute, "Received. Thank you." (or the toast, if the sheet was closed).
4. As the owner, list the app's feedback: `framebriar-admin feedback` (add `pull` to download the notes and screenshot). Expect one
   new report whose game is `travel-packing` with the note, the screenshot, the scene code `trips`, and an app version matching the
   Preview's commit. Nothing else identifying: no email, no trip name in the context fields.
5. Offline recovery: turn the network off, send a second report (expect "Saved on this device"), turn it on, and expect it to arrive.
6. Press Disconnect on Settings and confirm. Expect the invitation field back. Ask the owner to confirm the access is revoked.
7. Record the date, the commit and the result on the pull request or issue. Do not paste the invitation, any token or any report
   content that is personal.
