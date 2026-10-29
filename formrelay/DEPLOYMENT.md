# Deploy the prepared FormRelay implementation on Render

These settings refer to the private GitHub repository HANSTS13/FormRelay, whose root contains both the preserved original server/ and the improved formrelay/server/. Choose formrelay/server, not server and not the local Windows path. Changes are local until you approve a commit/push; Render cannot deploy files that are only on your computer. No deployment or push has been performed.

## Exact service settings

| Setting | Value |
| --- | --- |
| Service | Web Service |
| Source | GitHub: HANSTS13/FormRelay (authorize Render for this repository only) |
| Branch | feature/formrelay-setup (after approved commit/push) |
| Language/runtime | Node |
| Root Directory | formrelay/server |
| Build Command | npm ci --omit=dev |
| Start Command | npm start |
| Health Check Path | /health |
| Auto-Deploy | Off |
| Instances | One |
| Plan | Free for an ephemeral fictional-data demo; paid service plus disk for durable SQLite |

There is also an optional render.yaml Blueprint at the repository root with the free-demo configuration and automatic secret generation. Using the dashboard manually is fine. Creating a Blueprint/service is an actual deployment step; this preparation did not do that.

## Environment variables

| Variable | Value / purpose |
| --- | --- |
| NODE_VERSION | 24 (Node 24.x; required for the built-in SQLite API) |
| NODE_ENV | production |
| TRUST_PROXY | 1 (trust Render's reverse proxy; do not expose this configuration directly without a proxy) |
| CREATION_KEY | A privately generated random secret, at least 32 characters; required in production |
| RENDER_EXTERNAL_URL | Render supplies this automatically; the server uses it for canonical HTTPS links and QR codes |
| PUBLIC_BASE_URL | Optional override for the exact HTTPS origin, e.g. https://your-service.onrender.com; no path, credentials, query, or fragment |
| DB_FILE | Optional: /var/data/formrelay.sqlite ONLY after attaching a persistent disk mounted at /var/data |
| PORT | Render supplies this automatically; do not set it manually. Local fallback is 3000 |

For manual setup, generate CREATION_KEY on your own computer using this command, then put the output directly in Render's environment settings. Do not paste it into chat, screenshots, repository files, or the recipient URL.

~~~powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
~~~

The Blueprint generates this secret for you instead. To create requests from Chrome, enter the same secret in the extension's Deployment access key field. It is stored in Chrome session storage, cleared when Chrome restarts, and never sent to the recipient. The extension refuses to silently reuse a saved key for another backend. This is a shared organizer/demo key, not a multi-user account system. Rotating it blocks new creations using the old key, but does not revoke existing recipient links or owner tokens.

## Deployment and cross-device demonstration

1. After your approved commit/push, in Render choose New > Web Service, connect GitHub, and grant access only to the intended private repository. Never share GitHub credentials in chat.
2. Enter the service settings and environment variables above. Start a deployment and inspect its logs. Node 24.13 can print an experimental SQLite warning; that warning alone is not a startup failure.
3. Open https://YOUR-SERVICE.onrender.com/health and confirm {"ok":true}. Open https://YOUR-SERVICE.onrender.com/demo and confirm the scholarship page appears.
4. In Chrome reload FormRelay at chrome://extensions. Load this local directory if needed: E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\extension.
5. Open the deployed /demo in Chrome. In the popup set Backend URL to the same HTTPS origin and enter the deployment access key. Select only the three blank guardian fields, finish selection, and create a request.
6. Verify that the request link begins with the deployed HTTPS URL and that a QR image appears. Send ONLY that recipient link to the other device, or scan the QR. Do not share the deployment key or owner token.
7. On the recipient's phone, switch Wi-Fi off to use mobile data (or use another network). Enter Morgan Example / Fictional Teacher / 555-0100, then Send answers. The recipient needs no extension and no deployment key.
8. Keep the original Chrome tab open and unchanged. Within about three seconds the guardian answers should appear with green backgrounds. Verify Student Name and Annual Family Income are unchanged. Review and manually submit the original form yourself.
9. On a free service, open /health before your presentation to allow for startup delay. Free-service restarts/spin-down lose in-memory requests. Generate a fresh request after a restart.

The extension allows localhost:3000 and HTTPS *.onrender.com only. A custom domain requires updating manifest host_permissions, extension CSP connect-src/img-src, and validation in popup.js/background.js. Do not simply broaden permissions to all websites.

## Storage choices

Without DB_FILE, SQLite runs in memory: requests and answers vanish on process restart, redeploy, or free-service spin-down. Multiple independent instances would not share requests.

Durable SQLite is implemented and locally tested. Render persistent disks require a paid service. If you choose one yourself, mount a disk at /var/data and set DB_FILE=/var/data/formrelay.sqlite. The server creates the directory/database at runtime and restores unexpired requests after restart. Keep exactly one instance. Setting DB_FILE on an ordinary ephemeral filesystem does not make data durable. No disk, paid service, or external database was provisioned by this work.

Requests expire after 30 minutes, even after restart; expired rows are removed at startup and every minute. SQLite stores field definitions, answers, expiry, and hashed owner tokens. It does not store plaintext owner tokens. Database files and journals are gitignored. SQLite files and backups are NOT application-encrypted; expiry is not a guarantee of forensic erasure from disks, journals, or backups. Use fictional data only. A shared managed database and shared rate-limit store would be needed before scaling beyond one instance.

## Security review

- Production startup fails if there is no canonical HTTPS URL or creation secret of at least 32 characters. HTTPS is enforced behind the trusted proxy; canonical URLs prevent Host-header poisoning of recipient links and QR codes.
- Creating requests requires the deployment key. Reading answers requires a separate random owner token, checked against its SHA-256 hash with constant-time comparison. The recipient link never contains either secret.
- API rate limits are 300 requests/minute/IP (including polling) and 20 creation attempts/hour/IP; there is a 1,000 active-request cap. Limits reset on restart and users sharing one network/IP share the quota. This is basic abuse protection, not DDoS protection.
- No wildcard CORS is enabled. Recipient pages use same-origin APIs. Only same-origin or Chrome-extension Origin headers are accepted. Extension popup/service-worker fetches rely on explicit Chrome host permissions. CORS is not authentication; scripts outside browsers can forge Origin headers, so keys/tokens remain necessary.
- The backend validates allowed types, definition counts/keys, duplicate keys, sensitive labels, answer types/lengths, email/phone/number/date format, unexpected fields, malformed JSON, and a 32 KB body cap. Existing answers are not copied into definitions. A conditional SQLite update allows only one response.
- CSP restricts scripts to local files with no inline scripts/eval/remote executable code. The demo's submit handler was moved into demo.js to preserve its behavior under CSP. Referrer-Policy prevents recipient URLs leaking via referrers; clickjacking and MIME-sniffing headers are set.
- Anyone holding a recipient link can view its definitions and submit once before expiry. There is no recipient identity check, per-user account system, link revocation, field-level authorization, audit trail, or application encryption at rest. Sensitive-field classification is heuristic. These remain reasons NOT to collect confidential information in this demo.
- Extension mappings and owner tokens live only in the original tab; reload/navigation/browser restart loses them. Already filled fields are preserved. The extension never submits the original application.

## Verification

Latest local result: all 6 deployment/security/storage tests and all 3 Playwright tests passed (9 total, 0 failures). An isolated npm ci --omit=dev --offline install also served /health, /demo, and /demo.js with HTTP 200 without development dependencies. npm audit reported 0 vulnerabilities during installation. This result does not imply that the live deployment has been tested.

From formrelay/server run npm.cmd install, then npm.cmd test. The suite runs deployment/security/storage tests and the existing browser tests. Deployment tests simulate HTTPS proxy headers locally; they do not prove Render's live TLS or mobile-network access. Browser tests use Edge and simulate Chrome messaging. Actual Chrome installation, browser permission prompts, live Render TLS, QR scanning, and the different-network walkthrough still require manual verification after deployment.

Official references: [Render Web Services](https://render.com/docs/web-services), [environment variables](https://render.com/docs/environment-variables), [persistent disks](https://render.com/docs/disks), [free services](https://render.com/docs/free), [Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
