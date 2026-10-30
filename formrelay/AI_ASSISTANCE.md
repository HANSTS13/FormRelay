# AI Assistance: verified scope

Aibin's feature is included in the maintained `formrelay/` application. It uses local rules to offer plain-language suggestions and guidance; it does not call a language model. The recipient form always retains the original question, allowed choices, Other text controls and the backend's validation. Unknown questions keep their wording. There are no estimated confidence percentages or claims that a format check proves an answer is true.

The recipient can hide/show guidance without rerendering inputs or losing typed answers, radio selections, checkbox choices or Other text. Progress counts questions whose required controls and formats are complete. Format feedback is advisory; server validation remains authoritative. The original website is never automatically submitted.

## Run and demonstrate

1. Use the cloned repository's `formrelay/server/` directory and run `npm.cmd start`. After backend changes, finish pending in-memory demo requests before stopping the old server with Ctrl+C and restarting; restarting clears those requests.
2. Load the cloned repository's `formrelay/extension/` in Chrome. Reload an existing unpacked install at `chrome://extensions` and refresh the original form page after source updates.
3. Open `http://localhost:3000/demo`, select guardian fields, finish selection and create a new request. Open its recipient link in another tab.
4. The **AI Assistance** panel appears on the recipient page, not as a new extension popup tab. Check original questions and guidance, enter fictional answers and observe completion/format feedback. Toggle guidance and verify answers remain unchanged.
5. Submit the recipient form and review values filled on the original page. MCQs, checkboxes, dropdowns, Other text, overwrite confirmation and independent pending requests retain their existing workflows.

## Requirements and privacy

Local label assistance requires no API key, internet connection or paid service. It processes only the selected, validated field definitions; original filled answers are not uploaded to generate guidance. No new dependencies or extension permissions are required. SQLite, owner-token checks, request expiry, creation keys, rate limits, CSP and production HTTPS requirements remain in place.

Voice input is optional and offered only when the browser exposes SpeechRecognition. It requires explicit confirmation before starting the browser service and may require microphone permission and an internet connection. The browser may send audio to its online recognition provider. Use fictional data only. This is not an offline-voice or browser-compatibility guarantee. Cancellation, permission failures and unavailable services leave normal typing available. Real microphone transcription still needs manual testing; automated voice tests use a mock service and do not record audio.

Local HTTP is not encrypted. No recipient identity verification, factual-answer verification or encryption at rest is claimed. Local rules can still misunderstand unusual wording, so original questions stay authoritative. The root-level starter files are preserved for historical compatibility; use the maintained app paths above.

## Testing

Run `npm.cmd test` from `formrelay/server/`. Tests include conservative semantics (country, employment dates and household size), sanitized guidance generation, typed choices and Other answers, progress, guidance toggling, explicit speech consent with a mock service, the maintained real MV3 scholarship workflow and the legacy contributor flow.
