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


## Verified setup and changes

The repository's original root files are preserved. This imported implementation is in formrelay/; run and load the extension from this folder to use the fixes.

Windows PowerShell commands from the cloned repository:

~~~powershell
cd formrelay/server
npm.cmd install
npm.cmd start
~~~

Open http://localhost:3000/health and http://localhost:3000/demo. In Chrome open chrome://extensions, enable Developer mode, choose Load unpacked, and select the cloned repository's formrelay/extension directory. Pin FormRelay. On the demo click its icon, Select fields, close the popup, click Guardian Full Name, Guardian Occupation, and Guardian Phone. Clicking again deselects a field. Reopen the popup, Finish selection, Create remote request. Open the link in another tab, enter Morgan Example / Fictional Teacher / 555-0100, and Send answers. Keep the original tab open, wait about 3 seconds, review the green fields, and manually submit only when ready.

Run npm.cmd test from formrelay/server. Tests use installed Microsoft Edge in headless mode. To use installed Google Chrome instead, change channel in playwright.config.js from msedge to chrome.

Two automated tests passed: backend health/demo, QR image generation, owner-token isolation (including a different request's token), malformed/sensitive definitions, stripping existing values from request metadata, invalid phone and extra answer rejection, one response only; and a two-tab browser test using real content and recipient scripts with a simulated Chrome messaging bridge. That browser test verifies click deselection, selection-mode submit prevention, three guardian values, unchanged unselected values, input/change events, and review highlighting. Actual Chrome extension loading, popup/service-worker integration, phone access, expiry timing, and production HTTPS have not been tested.

Fixes include blocking submit and Enter during selection, excluding populated/invisible inputs and common credential labels, reading selection from the current tab, copying only field definitions on the backend, and validating typed answers. Mappings use references to the selected DOM elements in the original tab; disconnected/replaced elements are skipped. Mappings and pending requests do not survive page reloads, navigation, or browser restarts. Complex reactive forms remain unsupported.

Deployment: use Root Directory formrelay/server when deploying this imported implementation. Set TRUST_PROXY=1 only behind a trusted single reverse proxy such as Render, so links and QR codes use HTTPS. The extension permits localhost:3000 and HTTPS subdomains of onrender.com only. Other deployment hosts need explicit manifest and URL-validation changes. Phone access needs a deployed HTTPS backend; localhost on a phone points to the phone itself.

Security limits: fictional data only. Recipient links grant access to field definitions and allow one submission; there is no recipient identity verification, rate limiting, durable database, abuse protection, request revocation, or production monitoring. Requests expire after 30 minutes and disappear on server restart. Owner tokens protect answer reads but remain in memory while the tab is open. Heuristic sensitive-field detection is incomplete; users must avoid sensitive data. Do not use on real confidential applications. No production deployment was performed.

Dependencies: Express and qrcode at runtime; @playwright/test for development only. npm audit reported zero vulnerabilities at installation. npm.cmd avoids PowerShell's npm.ps1 execution-policy restriction without changing system settings. If your network certificate requires Windows trust, set $env:NODE_USE_SYSTEM_CA='1' before npm.cmd install; never disable TLS verification.
