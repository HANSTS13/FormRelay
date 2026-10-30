# FormRelay MVP — hackathon prototype

For the latest Fields / Requests / Settings UI, tab/document isolation, repeated requests, accessible controls and verified scope, read [UPGRADE_REPORT.md](UPGRADE_REPORT.md).

For the current hackathon presentation, follow [LOCAL_DEMO.md](LOCAL_DEMO.md) for the two-tab localhost workflow, optional same-Wi-Fi phone access, and troubleshooting. Production configuration remains available for future use.

Aibin's recipient-side assistance is integrated in the maintained app. See [AI_ASSISTANCE.md](AI_ASSISTANCE.md) for local guidance, progress, format feedback, optional browser speech input and privacy limitations.

Controlled demo, **not** production software. Use fictional data only. It has no recipient identity verification, application encryption at rest, or comprehensive field classification. Optional SQLite persistence and deployment safeguards are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Run locally

1. Install Node.js 24.x and Google Chrome.
2. Open terminal in `server/` and run `npm install` then `npm start`.
3. Open `http://localhost:3000/demo` in Chrome.
4. In Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose `extension/`.
5. On the demo page click the extension icon, then **Select fields**. Close the popup and click Guardian Name, Guardian Occupation, Guardian Phone.
6. Reopen extension, **Finish selection**, then **Create remote request**.
7. Copy the returned link to a second browser tab, fill and submit; original tab is updated within ~3 seconds.
8. For an optional phone on the same trusted Wi-Fi, follow the LAN_BASE_URL and creation-key steps in [LOCAL_DEMO.md](LOCAL_DEMO.md). Keep the extension backend at http://localhost:3000.

## Deploy on Render

Use the exact settings and security/storage instructions in [DEPLOYMENT.md](DEPLOYMENT.md). The repository Root Directory is **formrelay/server**, Build Command **npm ci --omit=dev**, Start Command **npm start**. Production requires a private creation key entered in the extension. No deployment has been performed.

## Limitations / known safeguards

- Uses SQLite in memory by default (lost on restart); optional DB_FILE enables file-backed SQLite, 30-minute expiry, 32 KB request limit, one response per request, random request identifiers and a separate secret for the requester to read answers.
- QR/link is a bearer capability: anyone holding it can submit. Never use sensitive or private information; expiry does not authenticate recipients.
- Field selection supports native text/email/tel/number/date inputs, textarea, single-select, radio groups, and checkboxes. See [COMPATIBILITY.md](COMPATIBILITY.md) for mapping confirmation, dynamic controls, tests, and exclusions.
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

Earlier baseline verification (before deployment preparation): backend health/demo, QR image generation, owner-token isolation (including a different request's token), malformed/sensitive definitions, stripping existing values from request metadata, invalid phone and extra answer rejection, one response only; and a two-tab browser test using real content and recipient scripts with a simulated Chrome messaging bridge. That browser test verifies click deselection, selection-mode submit prevention, three guardian values, unchanged unselected values, input/change events, and review highlighting. Actual Chrome extension loading, popup/service-worker integration, phone access, expiry timing, and production HTTPS have not been tested.

Fixes include blocking submit and Enter during selection, excluding populated/invisible inputs and common credential labels, reading selection from the current tab, copying only field definitions on the backend, and validating typed answers. Mappings use references to the selected DOM elements in the original tab; disconnected/replaced elements are skipped. Active request context is session-scoped and can survive same-origin navigation; DOM replacements need explicit confirmation. Browser restart loses the session context. Framework-controlled native controls are best-effort; see [COMPATIBILITY.md](COMPATIBILITY.md) for tested React behavior and unsupported cases.

Deployment: use Root Directory formrelay/server when deploying this imported implementation. Set TRUST_PROXY=1 only behind a trusted single reverse proxy such as Render, so links and QR codes use HTTPS. The extension permits localhost:3000 and HTTPS subdomains of onrender.com only. Other deployment hosts need explicit manifest and URL-validation changes. Phone access can use the optional development-only LAN_BASE_URL workflow in [LOCAL_DEMO.md](LOCAL_DEMO.md), or a future HTTPS deployment. localhost on a phone points to the phone itself.

Security and storage review: see [DEPLOYMENT.md](DEPLOYMENT.md) for current safeguards, required production configuration, persistence options, and remaining limitations.

Dependencies: Express, qrcode, and express-rate-limit at runtime; built-in node:sqlite requires Node 24.x; @playwright/test, React, React DOM and Vue are development-only test dependencies. npm audit reported zero vulnerabilities at installation. npm.cmd avoids PowerShell's npm.ps1 execution-policy restriction without changing system settings. If your network certificate requires Windows trust, set $env:NODE_USE_SYSTEM_CA='1' before npm.cmd install; never disable TLS verification.
