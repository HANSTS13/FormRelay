# FormRelay MVP — hackathon prototype

Controlled demo, **not** production software. Use fictional data only. It has no recipient authentication, persistent storage, production-grade encryption, or comprehensive field classification.

## Run locally

1. Install Node.js 20+ and Google Chrome.
2. Open terminal in `server/` and run `npm install` then `npm start`.
3. Open `http://localhost:3000/demo` in Chrome.
4. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose `extension/`.
5. On the demo page click the extension icon, then **Select fields**. Close the popup and click Guardian Name, Guardian Occupation, Guardian Phone.
6. Reopen extension, **Finish selection**, then **Create remote request**.
7. Copy the returned link to a second browser tab, fill and submit; original tab is updated within ~3 seconds.
8. To test on a phone, deploy `server/` to Render, then set backend URL in popup to its `https://your-app.onrender.com` URL. Open `https://your-app.onrender.com/demo` in Chrome and repeat.

## Deploy on Render

- Commit the whole project to GitHub (never commit credentials).
- Render > New > Web Service > connect repo > **Root Directory** `server` > Runtime Node > Build `npm install` > Start `npm start` > Free instance.
- Wait for the published HTTPS URL; confirm `/health` returns `{ "ok": true }`.
- In extension popup enter that URL. For a real phone, visit link or scan QR.

## Limitations / known safeguards

- Uses in-memory requests (lost on restart), 30-minute expiry, 32 KB request limit, one response per request, random request identifiers and a separate secret for the requester to read answers.
- QR/link is a bearer capability: anyone holding it can submit. Never use sensitive or private information; expiry does not authenticate recipients.
- Field selection supports simple text/email/tel/number/date `<input>` elements on the main page, not CAPTCHA, frames, select, textarea, credentials, complex reactive widgets, or arbitrary sites.
- No AI is included; automation alone aligns with domain. Don't claim AI-based mapping exists.
- Demo automatically fills only while original tab remains open. The extension checks approximately every 2.5 seconds; this is polling, not WebSockets.
- Owner token is held in extension state, not the shared URL, and must not be sent to recipient.
- The content script will not overwrite nonempty fields; it does not submit final application.
- The application is a proof of concept, not secure enough for handling confidential information or deployment to the general public.
