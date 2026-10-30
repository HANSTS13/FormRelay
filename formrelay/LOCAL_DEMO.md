# FormRelay: localhost hackathon demonstration

No deployment, paid service, internet connection, or AI API is required once Node dependencies and your browser are installed. Use Node 24.x. This guide refers to the improved formrelay/ directory inside the cloned FormRelay repository, not the preserved original server/ directory.

## Start a two-tab demo

Open a VS Code PowerShell terminal and paste:

~~~powershell
cd E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\server
$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:PUBLIC_BASE_URL = ''
$env:RENDER_EXTERNAL_URL = ''
$env:TRUST_PROXY = ''
$env:LAN_BASE_URL = ''
$env:CREATION_KEY = ''
npm.cmd start
~~~

The environment assignments apply only to this terminal and its child processes; they do not edit Render settings or delete files. npm.cmd start is the Windows PowerShell equivalent of npm start and avoids npm.ps1 execution-policy errors. With no NODE_ENV set, npm start also defaults to development. Explicit NODE_ENV=production still activates all production safeguards.

Dependencies are already installed on this computer. Only if node_modules is missing, run npm.cmd ci before starting. Keep the server terminal open. The expected message is FormRelay development server: http://localhost:3000. The SQLite experimental warning on Node 24.13 does not mean startup failed.

Open http://localhost:3000/health; it should show {"ok":true}. Open http://localhost:3000/demo. Local mode binds to 127.0.0.1, so other devices cannot connect unless you explicitly enable LAN mode below.

## Load the extension

1. Open Chrome and enter chrome://extensions.
2. Enable Developer mode. Click Load unpacked and choose:
   E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\extension
3. If already installed, click its Reload button instead of loading another copy. Refresh the demo tab before starting a new request, so it gets the latest content script.
4. Open FormRelay using Chrome's extensions menu (puzzle-piece button); pin it if useful.
5. Set Backend URL to http://localhost:3000. Clear the Access key field for the normal two-tab demo. Previous online settings are remembered, so explicitly check both values.

## Complete two-tab presentation

1. In the original demo tab, confirm Student Name is Demo Student and the guardian/income fields are blank.
2. Open FormRelay and click Start selection, then close the popup.
3. Click Guardian Full Name, Guardian Occupation, and Guardian Phone. Each gets a solid green outline. Click a selected field again to deselect; select it once more before proceeding. Leave Student Name and Annual Family Income alone.
4. Reopen FormRelay, click Finish selection, then Create remote request. Confirm the link starts with http://localhost:3000/r/ and the QR image appears.
5. Copy the link into a second Chrome tab. Keep the original tab open; do not refresh or navigate it.
6. Enter Morgan Example, Fictional Teacher, and 555-0100. Click Send answers and wait for Submitted!.
7. Return to the original tab. Within roughly three seconds, the guardian fields should contain those values with green backgrounds. Student Name remains Demo Student; Annual Family Income remains blank. There is no automatic original-form submission.
8. Explain that the original user reviews the answers and manually submits. The sample's Submit demo button only shows a message; it sends nothing to a real institution.

To repeat, refresh the original demo page and start a fresh selection/request. Each recipient link accepts only one response. The backend allows 20 creation attempts/hour/IP; reuse the successful demonstration or wait for the limit window if you reach it. Do not refresh the original tab while a request is pending.

## Optional phone on the same Wi-Fi

The extension continues to use localhost. LAN_BASE_URL changes only the recipient URL and the content encoded in the QR image. It never broadens extension permissions. The phone needs no extension, owner token, or access key.

1. Connect the computer and phone to the same trusted Wi-Fi. For this check, ensure the phone uses Wi-Fi rather than mobile data. Guest, school, hotel, and hackathon networks may isolate devices even on the same network name.
2. Stop the current server with Ctrl+C in its own terminal. Run ipconfig and find the IPv4 Address for the active Wireless LAN/Wi-Fi adapter. Do not use a VPN, loopback, or disconnected adapter. No IP address is hardcoded into the project.
3. Paste the commands below. At the prompt, enter only that IPv4 address. These commands generate a fresh creation key and copy it to your clipboard without printing it. Paste it only into FormRelay's Access key field; do not put it in chat or the recipient link.

~~~powershell
cd E:\hackathonHalloween\formrelay-starter\formrelay-starter\FormRelay\formrelay\server
$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:PUBLIC_BASE_URL = ''
$env:RENDER_EXTERNAL_URL = ''
$env:TRUST_PROXY = ''
$formrelayWifiIP = Read-Host 'Enter the Wi-Fi IPv4 address from ipconfig'
$env:LAN_BASE_URL = "http://${formrelayWifiIP}:3000"
$env:CREATION_KEY = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
Set-Clipboard -Value $env:CREATION_KEY
Write-Host "Phone health check: $env:LAN_BASE_URL/health"
npm.cmd start
~~~

4. On the computer, keep http://localhost:3000/demo open. In the extension leave Backend URL at http://localhost:3000 and paste the generated key into Access key (Ctrl+V). The key is required for LAN request creation and stored only in the extension's session storage.
5. On the phone, open the printed Phone health check address using http:// explicitly. You should see {"ok":true}. localhost on a phone points to the phone itself, so never use localhost there.
6. Refresh the computer's demo tab before a new selection. Repeat the three-field selection and request creation. The recipient link now starts with the computer's configured Wi-Fi address. The QR image is fetched through localhost, but encodes the LAN recipient link.
7. Scan the QR with the phone's camera or copy the recipient link to the phone. Enter the same fictional details and submit. Confirm that the original computer tab fills without refresh and the unselected fields remain unchanged.
8. Stop the server when finished. To return to a two-tab-only demo, clear LAN_BASE_URL and CREATION_KEY using the first command block, restart, and clear the extension's Access key field.

Supported LAN addresses are private IPv4 ranges: 10.x.x.x, 172.16.x.x through 172.31.x.x, and 192.168.x.x. The configured port must match PORT (normally 3000). LAN mode requires a creation key of at least 32 characters and is rejected in production. Wi-Fi addresses can change; rerun ipconfig, update LAN_BASE_URL, restart, and generate a fresh link if needed. Existing links are not rewritten.

## Firewall and HTTP limitations

- LAN mode listens on 0.0.0.0, meaning all IPv4 network interfaces, subject to the firewall. Local-only mode listens on 127.0.0.1. Production still uses 0.0.0.0 and keeps its HTTPS requirements.
- If the phone cannot open /health, check the address, port, same Wi-Fi, and network isolation first. Windows Defender Firewall can block inbound connections even when requests from this computer succeed. Do not disable the firewall, bypass organization policy, or forward a router port.
- On your own trusted Private network, you may allow Node.js through Windows Firewall on the Private profile only. For tighter control, use Windows Defender Firewall with Advanced Security (wf.msc), create a Custom inbound rule for the installed node.exe, TCP local port 3000, remote scope Local subnet, and Private profile only. An administrator may be required. This work did not change firewall settings. See [Microsoft firewall guidance](https://support.microsoft.com/en-us/windows/security/windows-security/firewall-and-network-protection-in-the-windows-security-app).
- HTTP LAN traffic is unencrypted. People with network visibility may capture field definitions, answers, bearer links, or owner credentials. Use fictional data on trusted Wi-Fi only. This is unsuitable for confidential forms or an untrusted/public network.
- A browser may warn about HTTP or request local-network permission. Follow normal browser prompts only when the destination is your own computer. Do not disable browser security or force HTTPS for a plain HTTP server. No special secure-context browser APIs are needed on the recipient page.
- CORS remains restricted, with no wildcard access. The recipient makes same-origin requests to its LAN address; the extension's creation/polling/QR requests remain at localhost. No broad LAN host permissions were added.
- Anyone with a recipient link can view definitions and submit once within 30 minutes. Owner tokens still protect reading answers; creation keys, validation, rate limits, one-response enforcement, CSP, and sensitive-field exclusions remain in place.
- In-memory requests disappear when the server restarts. Optional DB_FILE=./data/demo.sqlite enables local SQLite persistence; this does not preserve the extension's original-tab mapping after page reload or browser restart. Database files are gitignored. No paid storage is needed locally.

## Verification and troubleshooting

Run npm.cmd test from formrelay/server. The earlier native-form baseline passed 20 tests. See UPGRADE_REPORT.md for the expanded UI, lifecycle, real-extension and framework suite results. Tests cover production HTTPS/key safeguards, owner isolation, expiry, rate limits, restart persistence, LAN URL validation, exact QR bytes for the configured LAN URL, response submission, and two-tab autofill without refresh or changes to unselected fields. Ordinary page tests use Edge with simulated messaging; the additional real MV3 extension test uses test Chromium. The team's installed Chrome toolbar popup still needs a manual check.

A separate smoke test used this computer's real Wi-Fi interface and passed health, recipient loading, QR generation, submission through the LAN address, and polling through localhost. It used a temporary test server that was closed afterward. This is not a physical-phone or firewall reachability test. A second phone still requires the steps above; no phone test was performed.

If you see EADDRINUSE, another program is using port 3000. Stop the previous FormRelay server in its own terminal using Ctrl+C; do not terminate unrelated processes. If startup demands HTTPS, verify NODE_ENV is development and the old production URL variables are cleared as in the command block. If the extension says access denied, check the LAN creation key; if a request is already submitted/expired or the server restarted, create a fresh request. A fresh selection must be made after refreshing the original demo tab.

If request creation reports HTTP 400 "Unsupported fields", an older backend may still be running even though /health succeeds. Stop the old FormRelay server, open a terminal in FormRelay/formrelay/server, and run npm.cmd start. Restart the server after backend code updates; reloading the Chrome extension does not restart Node.js. Multiple old servers can also bind different local addresses on the same port. Check Get-NetTCPConnection -State Listen -LocalPort 3000 if the wrong backend still responds; stop only servers you have identified as FormRelay. Recreate in-memory requests after restarting. The popup now retains the backend error and HTTP status; for HTTP 429 wait for the displayed retry interval rather than restarting to bypass the limit.

The Render configuration is preserved in render.yaml and DEPLOYMENT.md for future use. No deployment, push, merge, or deletion was performed for this localhost work.


## Wider native form support

The scholarship workflow above is preserved. FormRelay also supports textarea, single-select, radio, checkbox, and dynamically added native controls. Use Check compatibility / results before selecting, and use explicit replacement confirmation when a site rerenders a selected control. See [COMPATIBILITY.md](COMPATIBILITY.md) for supported scope, verification behavior, and the expanded tests. Restart the backend and reload the extension before using the new field types.


## Updated Fields / Requests / Settings popup

See [UPGRADE_REPORT.md](UPGRADE_REPORT.md). Set the backend/key in Settings. Fields holds this tab/document's temporary selections; Requests retains links, QR codes, expiry and fill results when the popup closes. Use Clear selection or remove an individual field before creating a request. New request clears only the draft and can be used while earlier requests are pending. Each request keeps its own field mappings. After navigation, only the exact original URL can recover requests, and replaced controls require explicit confirmation.

## Multiple pending requests: manual regression check

1. Start the backend with npm.cmd start from FormRelay/formrelay/server. Open http://localhost:3000/demo. After installing this source update, reload FormRelay at chrome://extensions and refresh the demo once.
2. In Settings use http://localhost:3000 (blank access key for local-only mode). In Fields start selection, close the popup, click Guardian Full Name, reopen the popup, finish selection and create request A. Copy its link.
3. In Requests click New request while A is still Pending. Start selection, close the popup and select Guardian Occupation. Finish selection and create request B. A remains saved. You can also reuse the same field; if an incoming answer would replace an existing answer, that request waits for explicit overwrite approval.
4. Open B's link in another tab, enter Fictional Teacher and send answers. Only Guardian Occupation should fill. Guardian Full Name should remain empty.
5. Open A's link, enter Morgan Example and send answers. Guardian Full Name should fill; Guardian Occupation must remain Fictional Teacher. Student Name should remain Demo Student; Guardian Phone and Annual Family Income should remain empty. FormRelay must not submit the original form.
6. Close and reopen the popup. In Requests use Saved requests to inspect A and B independently, including their links, questions, QR codes and Autofilled statuses. New request never revokes or cancels either link.
7. Open a second /demo tab. Its Fields draft should be empty. Requests from other tabs are available for inspection; mapping confirmation and Undo are enabled only in their original document. Return to the first tab to continue its requests.
8. For a pending request, navigating to a different URL or closing its source tab leaves an Original Form Unavailable history entry. It never fills the unrelated page. If the source tab is still open, return to its exact original URL, activate the extension, and explicitly confirm replacement mappings. Closing a source tab permanently detaches that request's mappings; opening the same URL in a new tab does not reattach them.
9. Pending links expire after 30 minutes. Expiry affects that request only. Completed fill results stay visible. Expired links cannot be reused; create a fresh request. Server security and creation/polling rate limits still apply; polling slows as the number of pending requests grows.

Requests and owner tokens are kept in trusted extension session storage across popup closure and service-worker restarts, not a complete browser restart or an unpacked-extension reload. Live DOM mappings stay in each original document; after a page refresh, answers require explicit mapping confirmation. Closed-tab requests remain visible for this browser session but are no longer automatically polled or filled; their backend links remain valid until expiry. Responses waiting while you select fields are received but filled only after selection finishes. This avoids synthetic input events interfering with selection mode. Use fictional data; no production security guarantees are added.

## Question, Other, dropdown and reuse update

After finishing pending in-memory demo requests, stop the backend in its terminal with Ctrl+C and run npm.cmd start again from formrelay/server to load the updated choice/Other validation. Reload the unpacked extension at chrome://extensions and refresh the demo page once. A server restart clears in-memory requests; an extension reload can clear extension session records. Create fresh test requests after updating.

Full question labels and permitted options appear on the recipient form. Native dropdowns work in selection mode. For a custom dropdown, first open it outside selection mode so its options are loaded, close it, then start selection and click the question. Only a compatible noneditable ARIA listbox contract is supported; Check compatibility explains unsupported controls. See [COMPATIBILITY.md](COMPATIBILITY.md) for Other-field associations and limits.

To test reuse, delegate Guardian Full Name, submit Morgan Example, and wait for Autofilled. Click New request, select Guardian Full Name again, and submit Taylor Example. The original value must remain Morgan Example until you open Requests, choose that request, click Replace existing answer for Guardian Full Name, and confirm. Cancelling confirmation must keep the old value. New request/Clear selection remove temporary styling without deleting request history. Never submit the original form automatically.
