# Feedback to the developer (#127)

At the stable Preview origin `https://travel-packing-preview.vercel.app` and exact local origin
`http://localhost:8080`, people who have an invitation can send the developer a note and optional screenshot from inside the
app. Arbitrary Vercel deployment URLs and Production contain no active feedback feature. This page explains what is captured,
what never is and how to check it. Developer setup (package access, build gates and the fake service used in tests) is in
[framebriar.md](framebriar.md).

Nothing in this repository holds a token, an invitation or a credential. `<INVITATION>` below is a placeholder and must be shared
privately. The app id and origins are public configuration and are written exactly.

## What is captured, and what never is

A report holds what the person typed and a few approved codes. The review sheet shows the notes and the screenshot (if any), and
lists the rest under "Also sent".

| Sent                                                                                                          | Never sent or captured                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The notes the person wrote (2,000 characters at most)                                                         | Passwords, sign-in codes, invitations, tokens                                                                                         |
| A screenshot of the screen, **only in Preview/local/test builds**, ticked by default and removable per report | Email addresses; trip names, places, dates or ids in the report's own fields                                                          |
| The screen as a code: `trips`, `new-trip`, `trip`, `review`, `staples` or `other`                             | The address of the page (it contains a trip id)                                                                                       |
| A viewport class (`phone`, `tablet`, `desktop`), the input kind, the app version, the capture time            | The signed-in address, an invitation, any password field, and anything on the sign-in and account screens (nothing is captured there) |

- A screenshot shows what is on screen, including trip names and places. The sheet says so next to the tick box. Production
  contains no Framebriar UI, SDK or screenshot code (see "Preview build and exact-origin boundary" in
  [framebriar.md](framebriar.md)).
- Telemetry is off. Nothing here collects performance or diagnostic data; adding it later needs its own decision and a disclosure line
  in Settings.
- Capture is blocked on the sign-in, sign-up, verify, forgot-password, reset-password, finish-setup and access-denied screens, in the
  Feedback button and in the capture code itself. On Settings the screenshot leaves out the signed-in address, the invitation form and
  every password field before the picture is made, and there is no screenshot at all while the Close account dialog is open.

## Owner setup (once)

These steps belong to the owner of the Framebriar service and of this repository; the app's developers cannot do them.

1. **Register the app:** `framebriar-admin games add travel-packing` (builds: any). Check status first; do not add a duplicate if it
   already exists.
2. **Use only the two approved origins:** the app enables Framebriar at stable Preview
   `https://travel-packing-preview.vercel.app` and exact local `http://localhost:8080`. Start local development with
   `npm run dev -- --hostname localhost --port 8080`; `localhost` and `127.0.0.1` are different origins. The shared service
   already has both origins in its registry and Azure CORS. Leave every existing service origin and app unchanged. Arbitrary
   Vercel deployment URLs and Production remain disallowed.
3. **Install the SDK:** the repository pins `@masra91/framebriar@0.4.1` from Mason's private GitHub Package. The committed
   `.npmrc` contains only the scoped registry and an environment-variable placeholder; package credentials remain outside the
   repository. Access and update requirements are in [framebriar.md](framebriar.md).
4. **Let a person connect (separate approval required):** issue an invitation for the app, for example
   `framebriar-admin invite travel-packing --days 7 --uses 1`, and give `<INVITATION>` to that person privately. An invitation works once
   and expires; the connection it creates lasts 30 days.

## Connecting and disconnecting (for the person using the app)

- **Connect:** Settings, "Send feedback to the developer". Paste the invitation into the field and press Connect. The field empties
  at once and the invitation is not stored anywhere. The connection belongs to your account, not the browser: it works on your other
  devices and survives clearing the browser's storage. When it works the section says "Connected" and until when. The Feedback button
  in the header then turns on.
- **Send a report:** press Feedback, write what happened, untick the screenshot if it is offered and you don't want it, and press Send.
  When the screenshot is offered you can **draw on it** with a finger, a pen or a mouse (four inks: Black, Red, Blue, Yellow; Undo and
  Clear drawing; Undo also brings back a drawing you just cleared). Anything you draw is part of the picture that's sent, and nothing
  is sent until you press Send. The marks are put on the picture only at Send, and the picture may be at most 4,000,000 bytes (4.0 MB): if it is larger, it
  isn't sent and nothing is shrunk or cropped (remove marks, or untick the screenshot to send your notes only). Drawing needs a pointer;
  the notes are the way to describe a problem without one. Cancelling, signing out or switching account throws the marks away.
  "Saved on this device" means the report is kept here and will go out when the device is online; "Received" means the developer's
  service has it. Reports waiting to send are kept on this device for your account across reloads, offline periods and even a disconnect.
  **Signing out deletes them** (they are never sent while signed out, and never shown to or sent by another account on the same
  browser). Settings also has "Delete unsent reports".
- **When access ends:** a notice under the header says the access expired or needs a new invitation (the same notice, with a button
  to Settings, appears on every screen except Settings). Reports saved meanwhile stay on the device until a new invitation is added.
- **Disconnect:** Settings, "Disconnect", then confirm. Feedback access for your account is ended on the service. If the service cannot be reached, nothing changes and it says so. Reports that have not been sent stay on the device.

## Real delivery check (manual, with a separately approved real invitation)

The automated tests use a fake service and never call the real one. If invitation creation is separately approved, check one
real delivery from exact local origin `http://localhost:8080` or the stable Preview after its reviewed deployment. Never use
Production or an arbitrary Vercel deployment URL, and use synthetic notes/screens only.

1. The owner issues one invitation for `travel-packing` (step 4 above) and gives it to the person doing the check.
2. Open the reviewed stable Preview, or start `npm run dev -- --hostname localhost --port 8080` and open
   `http://localhost:8080`, then sign in with a synthetic test account. On Settings, paste the invitation and press Connect.
   Expect "Connected", an expiry date about 30 days away, and the field empty.
3. On the Trips screen press Feedback. Expect the sheet with the screenshot ticked and a thumbnail. Write "Local delivery check",
   press Send. Expect "Saved on this device", and then, within a minute, "Received. Thank you." (or the toast, if the sheet was closed).
4. As the owner, list the app's feedback: `framebriar-admin feedback` (add `pull` to download the notes and screenshot). Expect one
   new report whose game is `travel-packing` with the note, the screenshot, the scene code `trips`, and an app version matching the
   local build. Nothing else identifying: no email, no trip name in the context fields.
5. Offline recovery: turn the network off, send a second report (expect "Saved on this device"), turn it on, and expect it to arrive.
6. Press Disconnect on Settings and confirm. Expect the invitation field back. Ask the owner to confirm the access is revoked.
7. Record the date, the commit and the result on the pull request or issue. Do not paste the invitation, any token or any report
   content that is personal.
