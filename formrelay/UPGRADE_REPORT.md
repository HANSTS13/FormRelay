# FormRelay 0.4 upgrade report

The working implementation is in `FormRelay/formrelay/` inside the workspace. The preserved original `FormRelay/server/` and `FormRelay/extension/` copies were not changed. No deployment, push, merge, commit, or source-file deletion was performed.

## Architecture and reliability

| Component | Responsibility |
| --- | --- |
| Content script | Authoritative selection and exact DOM mappings for one document; value insertion and delayed verification. |
| Background service worker | Backend request creation, restricted networking, tab/document-scoped session records and cleanup. |
| Popup | Current-tab view, user actions, settings, compatibility/results and retained request link/QR. |
| Express backend | Existing request APIs, owner-token checks, typed validation, rate limits, expiry, QR and optional SQLite persistence. |

The baseline executed successfully: 20 tests. Regression coverage was added before the state changes. The new clear/remove regression initially failed because those operations did not exist; it was implemented and passed afterward.

Fixed root causes include global selection/status keys leaking across popup views, popup-only request-link state disappearing on close, one-shot content injection without teardown, unhandled invalidated extension contexts, ignored expiry/authorization failures, and late responses being evaluated against a newer active request. Draft selections now live in their original document; active request metadata/tokens use trusted-context Chrome session storage scoped by tab and document token. Owner tokens are excluded from public popup snapshots. Source selections are separated from locked active mappings.

Request creation runs in the worker, so closing the popup does not discard it. Reopening uses the current tab's live content state. New Request clears temporary mappings after response handling or expiry. Active waiting requests cannot be silently discarded. Session records are removed when their tab closes. A worker restart does not depend on global JavaScript variables retaining their contents.

Content injection has a versioned, disposable instance. It avoids duplicate handlers, cleans styles/listeners/observers/timers after invalidation or pagehide, and recovers through ordinary user activation. Normal runtime use does not need chrome://extensions Reload. After editing unpacked extension files, reloading the extension once remains expected; a page with an old, unmanaged content-script version may also need one page refresh.

## UI

The 392 by 600 popup uses plain HTML/CSS/JavaScript, system fonts, local SVG branding, restrained teal/neutral colors, accessible tab navigation, visible focus, reduced-motion support, concealed access keys, loading/error notices, and a scrollable main panel without horizontal overflow.

- Fields: current website/page connection, start/finish selection, count/list, individual removal, clear, request creation, compatibility and new request.
- Requests: retained request fields/link/QR, copy action, waiting/received/completed/partial/offline/expired status, expiry, original path, mapping confirmation, safe undo and new request.
- Settings: saved backend origin, session-only access key, save/test connection, supported-scope information and privacy reminders.
- Cancellation/revocation is explicitly unavailable. New Request is local workflow cleanup, not server revocation.

## Compatibility

Preserved native text/email/tel/number/date, textarea, select, radio, checkbox and dynamic form behavior. Added logical checkbox groups with array-valued opaque choice IDs. Repeated names/labels retain exact element references. IDs, names, form identity, accessible labels, options, structure and local route context are checked; source field values and raw option values are not uploaded.

Accessible div/span checkbox/radio widgets are supported only when they expose a concrete boolean aria-checked state, keyboard semantics, labels and a safe activation target outside buttons/links. The adapter activates the real handler and verifies the resulting state; it does not fake success by merely changing an ARIA attribute. Inert widgets fail verification. Custom dropdowns are not silently converted to unrestricted text fields.

Same-document steps can defer a hidden exact mapping and fill it when its original visible step returns. Route/identity changes are revalidated. Full same-origin navigation retains request context in the worker but restores no automatic DOM mapping: every replacement needs an explicit user click. Other-origin pages do not receive the old site's request fields. No automatic multi-page navigation is implemented.

Native prototype setters, bubbling events and delayed DOM checks are retained. Real React 18 and Vue v-model fixtures are tested. An Angular-style event-binding fixture is tested; no real Angular application was certified. Verification occurs after roughly 150 ms and another 500 ms and cannot guarantee that a website will never change a value later.

Google Forms and Microsoft Forms remain targets, not platform guarantees. The user-supplied Google Form was inspected read-only in a fresh browser: three native text questions with accessible labels were visible. Nothing was filled or submitted there. The user's explicit inspection-only constraint was respected. A Google-style accessible-label local fixture is covered; it does not certify the actual website. No real Microsoft Forms, college, scholarship portal, job portal or registration service was submitted.

## Tests

Final full-suite result: **34 executed, 34 passed, 0 failed, 0 skipped**: 11 backend/security/worker-session tests and 23 Playwright tests. The real-extension test includes multiple lifecycle scenarios within one test. The original scholarship workflow remains green. Syntax and Git whitespace checks also passed. Earlier development failures were corrected before this final run.

The suite includes:

- Backend health/demo, QR, owner isolation, malformed/sensitive definitions, formats, allowed options, checkbox-group arrays, expiry, rate limits and restart persistence.
- Standard native controls; duplicate/missing IDs and labels; ARIA labels; dynamic Add buttons; reordering/replacement; mapping confirmation; required/length constraints; protected/unsupported widgets; unchanged unrelated values; rejected/reverted values.
- Real React and Vue controlled state; Angular-style event bindings; native/ARIA checkbox groups and radio choices; same-document deferred steps.
- Popup reopen, tab isolation, clear/remove, new/consecutive requests, keyboard navigation, hidden access keys and backend error feedback.
- Real installed Manifest V3 extension in test Chromium: real popup HTML opened as a non-active extension tab, native Chrome APIs, actual backend/recipient round trip, retained link/QR, consecutive requests, original-page navigation and manual mapping confirmation.
- Worker restart: the test targets FormRelay's own isolated test worker, uses Chromium's developer Stop control, observes STOPPED then RUNNING, and verifies a worker-global marker was cleared, then checks retained request state. It does not rely on the misleading assumption that a generic stopAllWorkers call necessarily stopped an extension worker.
- Expired requests, invalidated contexts, stale updates, closed-tab cleanup, preparation locks, public-token exclusion and late-response isolation.

Manual testing still required: toolbar-popup behavior in the team's installed Google Chrome, physical phone/Wi-Fi/firewall access, clipboard behavior under local OS policy, representative third-party controls, real Angular, and accessibility/screen-reader auditing. No Google Form response submission was authorized or performed. Automated popup screenshots were visually inspected; this is not a full usability audit.

## Local installation and demonstration

Use Node 24.x. From a fresh PowerShell terminal:

```powershell
cd E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\server
$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:PUBLIC_BASE_URL = ''
$env:RENDER_EXTERNAL_URL = ''
$env:TRUST_PROXY = ''
$env:LAN_BASE_URL = ''
$env:CREATION_KEY = ''
npm.cmd start
```

Dependencies are installed already. New team checkouts can run `npm.cmd ci` first. To install the automated test browser, run `npx.cmd playwright install chromium`; the suite also uses installed Edge for its ordinary page tests. Then run `npm.cmd test`.

Open http://localhost:3000/demo. At chrome://extensions, enable Developer mode and load/reload:

```text
E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\extension
```

Refresh the original page once after installing this upgrade. In Settings keep the backend http://localhost:3000 and leave the access key empty for the two-tab demo. Start Selection, close the popup, click the guardian questions, reopen and Finish Selection, then Create Request. The Requests tab retains its QR/link after popup close. Open the recipient link in another tab, use fictional data, and verify original values/green review markers and untouched unselected fields. Review and manually submit only when appropriate. Use New Request to repeat without an extension reload.

For Google Forms or another site, use only a form you own or have permission to test. Activate FormRelay from Chrome's toolbar on that site, check compatibility first, and select supported unanswered controls. Respect login/CAPTCHA/site restrictions. For the supplied inspection-only Google Form, do not submit, and do not treat this report as evidence of a live Google end-to-end fill/submission test. Microsoft Forms/custom-widget tests require a separately permitted example.

Phone/LAN commands and firewall limitations remain in [LOCAL_DEMO.md](LOCAL_DEMO.md). The extension still talks to localhost; LAN_BASE_URL changes the recipient address/QR only. Explicit alternate localhost ports are now supported in Settings for local development; no arbitrary public HTTP backend or additional external website permissions were added.

## Security review

Preserved: random request IDs; separate hashed owner tokens and constant-time checks; creation key in production/LAN; 30-minute expiry; one response; 32 KB bodies; active-request cap; rate limits; HTTPS behind a trusted production proxy; CORS/origin checks; CSP/security headers; fictional-data policy and optional SQLite persistence. Existing API paths remain intact; creation responses add an absolute expiresAt timestamp without removing prior fields.

New/strengthened: per-tab/document isolation, request-preparation locking, late-response identity checks, worker-owned creation, session-only key/owner-token handling restricted to trusted extension contexts, public snapshot token exclusion, bounded network timeouts, no credentialed fetches/redirect following, stale-state rejection, versioned cleanup, original-step revalidation, allowed checkbox-group choices and explicit unsupported-widget reporting.

The manifest retains activeTab-based access to external sites and explicit backend permissions. Localhost permissions/CSP cover configurable local ports; existing HTTPS onrender.com support remains. No cookies, identity, broad all-sites, or CAPTCHA bypass permission was introduced.

Unresolved risks: sensitive-field classification is heuristic and may overblock or miss disguised fields; links are bearer capabilities with no recipient identity verification; there is no application encryption at rest, revocation, audit trail or production-grade abuse system. LAN HTTP is unencrypted. A website's own input/change/click handlers may autosave or perform network actions; normal submit events are blocked during selection/filling, and FormRelay itself never calls original-form submission APIs. Review unknown sites with fictional data. Synthetic-event-only restrictions are respected, not bypassed.

Frames, shadow DOM, rich text, multiple-select, files, unknown dropdowns, mixed-state ARIA widgets, closed/disabled controls, CAPTCHA/login-restricted areas and browser settings pages remain unsupported. ARIA radio groups cannot always be safely cleared by Undo; that limitation is reported instead of faking a reset.

## Files and Git

Branch: feature/formrelay-setup. All earlier uncommitted work was preserved. Changes are uncommitted; nothing was pushed or merged.

Created during this upgrade:

- extension/popup.css
- server/tests/reliability.spec.js
- server/tests/popup.spec.js
- server/tests/extension.real.spec.js
- UPGRADE_REPORT.md

Modified during this upgrade (some were already untracked from the prior task):

- extension/background.js, content.js, manifest.json, popup.html, popup.js
- server/index.js, fields.js, package.json, package-lock.json
- server/public/recipient.html, recipient.js
- server/tests/workflow.spec.js, deployment.test.cjs, compatibility.spec.js
- README.md, COMPATIBILITY.md, LOCAL_DEMO.md

Previously modified DEPLOYMENT.md and server/playwright.config.js remain preserved in the working tree. The original root server/extension copies and render.yaml remain unchanged. Generated browser profiles/screenshots/results and node_modules are not intended Git changes. React, React DOM and Vue remain development-only test dependencies; no UI framework or paid API was added to the application.

Final Git review: 24 pending paths (15 tracked modifications and 9 untracked files, including preserved prior work), no staged changes, no deleted source files, and HEAD unchanged at f7b9eaf423822a0554f994592f6de8823b5901c7. Secret-signature and forbidden-path scans found no credentials, .env files, node_modules, databases or key files in the intended change set. Runtime dependencies remain Express, express-rate-limit and qrcode; npm reported zero vulnerabilities during the test dependency install.
