# Native and accessible form compatibility

FormRelay supports common native controls and narrowly defined accessible checkbox/radio and single-choice dropdown adapters in the main document. See [UPGRADE_REPORT.md](UPGRADE_REPORT.md) for the earlier UI/lifecycle report and [LOCAL_DEMO.md](LOCAL_DEMO.md) for the current multiple-request workflow. This is not universal website compatibility. The scholarship demo, localhost/LAN configuration, owner-token access checks, request expiry, rate limits, and production HTTPS settings are preserved.

## Try the updated extension

1. Restart the backend from `formrelay/server` with `npm.cmd start` in development mode, following [LOCAL_DEMO.md](LOCAL_DEMO.md). Existing in-memory requests disappear on restart, so create a fresh request.
2. Open `chrome://extensions` and reload the existing FormRelay extension. Refresh the original form tab before selecting fields so that the updated content script is injected.
3. Open FormRelay and choose **Check compatibility / results**. Expand **Show field compatibility** to see available native fields and the reason each unavailable field is excluded. The report includes local form/structural hints, duplicate-label warnings, iframe/custom-widget counts, and selected-field results.
4. Choose **Start selection**. Blue dashed outlines identify supported controls; clicking a control or its native label selects it with a solid green outline. Click again to deselect. Clicking a radio/checkbox group selects the logical question. Filled fields are selectable, but a different incoming answer requires explicit overwrite approval. Non-submit `type="button"` controls can still reveal dynamic fields. Normal submit/reset buttons and Enter submission are blocked during selection.
5. Finish selection and create a request as before. The recipient sees matching text areas, dropdowns, radio choices, and checkboxes. An unchecked optional recipient checkbox sends an explicit `false`; a required checkbox must be checked.
6. After submission, open **Check compatibility / results** again. Green backgrounds mean the DOM values survived two delayed checks. Skipped/rejected values and controls that need confirmation are explained. Review the actual original page before manually submitting.

## Supported scope

| Control | Behavior and limits |
| --- | --- |
| Text, email, telephone, number, date | Native inputs; existing answers remain local and a different returned answer requires overwrite confirmation. Original constraints and retained values are checked. |
| Textarea | Native multiline text, up to 500 characters, subject to original constraints. |
| Single select | Native nonempty enabled choices, including an existing selection with overwrite approval; no multi-select. Dynamic options must be loaded before selecting the question. Changed choices pause for mapping confirmation. |
| Radio | One logical field per native form owner and name; each unnamed radio is separate. Answered groups are selectable with overwrite approval. Groups containing hidden/disabled members remain conservatively unavailable. |
| Checkbox | Single checkboxes are booleans. Labelled fieldsets, ARIA groups and question containers with related checkboxes form logical multi-choice questions, including supported Other text choices. |
| Accessible dropdown | Noneditable div/span/button controls with a single linked ARIA listbox (or a listbox itself), loaded unique options and observable aria-selected state. Opens the widget and activates the exact option, then verifies retention. Editable search/combobox widgets and unknown contracts are unsupported. |
| Dynamic controls | Event delegation and a MutationObserver detect new native controls without refreshing. Reordered connected controls retain their exact references. |
| Framework controls | Native prototype setters and bubbling events; real React 18 controlled text/textarea/select/radio/checkbox fixtures are covered by tests. Other frameworks are not individually certified. |

Limits: 20 selected logical fields, 50 choices per question, 1,000 characters per question label, 500 per choice label/answer, the existing 32 KB request body limit, and a scan of the first 1,000 controls. Oversized questions/choices and duplicate option identities are reported as unsupported rather than truncated or guessed.

## Question text, Other choices and reuse

Questions use associated labels, fieldset legends, ARIA labels/references and headings in explicit question containers. Option labels remain separate from question text. Checkbox/radio questions are represented once, with their permitted choices in the recipient form.

A plain Other option stays a normal choice. A custom-text choice requires an explicit data-other-input/aria-controls reference to a text input or textarea in the same question, or exactly one text input nested in that option's label. Sensitive/hidden-type inputs, missing explicit targets and ambiguous nested inputs are unsupported. Conditional Other inputs must already exist in the DOM and become editable after choosing Other. Dynamically created, unlinked Other controls require a verified adapter; they are not inferred from a nearby arbitrary textbox. Checkbox responses can combine ordinary choices and supported Other text. The backend validates the selected choice IDs and requires exactly the associated nonempty custom texts. Existing answers and DOM references are never included in creation payloads.

New request and Clear selection restore temporary styling while preserving saved requests. Any field may be selected again, including one held by another pending request. If a returned answer differs from a current nonempty value, that request pauses with an overwrite result. In Requests choose Replace existing answer and explicitly confirm. Approval applies to that request/field and the current local value; subsequent edits require fresh approval. Undo for an older request cannot modify a field owned by a newer request. Compound Other controls and custom dropdowns currently require manual undo.

These adapters were tested on local HTML/ARIA fixtures, including actual React/Vue fixtures elsewhere in the suite. This work did not submit or certify Google Forms, Microsoft Forms, or other third-party websites. Unsupported, dynamically virtualized, or trusted-event-only controls remain unavailable.

## Mapping confirmation

An exact connected DOM element is the primary identity. Names, IDs, labels, form ownership, choices, and a safe structural path are recorded locally. Names and labels are not used as global selectors to choose a fill target. Duplicate field names/labels therefore do not redirect a response to another matching field. Radio grouping follows native form ownership, not a global name lookup.

If a page replaces a control, changes its identity, or changes its choices, automatic filling pauses for that field. FormRelay does not automatically use the first matching label, name, ID, or DOM position, even when only one candidate seems plausible.

To resolve a pending field:

1. Open **Check compatibility / results** after page processing finishes.
2. Click **Confirm replacement for [field]**.
3. Close the popup and explicitly click the intended unanswered replacement on the page.
4. The replacement must have the same type, label, required status, and choice labels/order, and must pass the sensitive-field checks. FormRelay then binds that exact control and retries only that pending answer.

Changed/incompatible choices require a fresh selection/request or manual entry. Existing typed answers are never overwritten. Navigation/reload loses the in-tab DOM mapping; active same-origin requests can be restored with explicit mapping confirmation. Browser restart loses the session context.

## Event handling and verification

Value/checked properties are assigned through the native input, textarea, or select prototype setter. This avoids the instance setter tracking used by some controlled inputs. FormRelay sends bubbling `input` and `change` events. For checkboxes/radios it also sends a generic non-activating `click` event for React's checked-state tracking; native controls do not use activating clicks. The restricted accessible div/span checkbox/radio adapter activates its real handler and verifies aria-checked. FormRelay never calls original form submission APIs.

Verification checks the exact elements, values, identity, constraints, and supported status after approximately 150 ms and another 500 ms. A rejected/reverted value is reported as failed; a replaced element requires confirmation. This is a finite DOM check, not proof of a framework's internal state or a guarantee that the page will never change the value later. Trusted-user-event-only sites cannot be made compatible by synthesizing trusted events.

Normal submit events are blocked during filling/verification. Third-party pages may run their own application logic in response to input/change handlers; test a site with fictional data before using it. FormRelay itself never submits the original application. Undo skips disconnected controls or values that the user has edited since insertion.

## Security and unsupported cases

- Passwords, hidden inputs, authentication identifiers/tokens, OTPs, payment credentials, relevant autocomplete hints, and entire native forms containing password inputs are blocked conservatively. Detection uses field type, label, name, ID, autocomplete, and form context. This is heuristic classification, not a guarantee of detecting every disguised sensitive field. Do not select confidential information.
- Only explicit field definitions cross the network. Existing answers, native selected/checked state, DOM IDs/names/paths, and raw website option values are not included. Select/radio choices use opaque request IDs; the original choice values remain in the content script.
- Backend validation checks typed answers, booleans, required checkboxes, allowed choice IDs, duplicate keys, lengths, and formats before storing responses. No database schema migration is needed for existing text-only requests.
- Iframes, shadow DOM, rich-text/contenteditable controls, unknown custom dropdowns/widgets, multi-selects, file uploads, CAPTCHA, mixed-state controls, closed/disabled controls, and browser-restricted pages are unsupported. The supported accessible checkbox/radio contract is documented in UPGRADE_REPORT.md. No login, browser permission, CAPTCHA, or security control is bypassed. External-site access still uses activeTab. Localhost backend permissions/CSP now cover explicit alternative local ports; no additional external website access was granted.
- Source-site CSS and custom event handlers can interfere. Detached controls and delayed page changes are reported, not silently mapped. Keep reviewing values manually.

## Tests

The earlier native-control baseline passed 20 tests. See UPGRADE_REPORT.md for the latest expanded suite results.

From `formrelay/server`, run `npm.cmd test`. The suite includes backend/security/LAN checks, native controls with recipient submission, labels and layout variations, radio/checkbox grouping, dynamically added/replaced controls, duplicate names and DOM reordering, explicit mapping confirmation, original constraints, page-reverted values, real React 18 controlled state/rerendering, and the existing scholarship workflow.

React, React DOM and Vue are development-only test dependencies, served locally by the test harness. FormRelay itself remains plain JavaScript, Node.js/Express, and Manifest V3. Ordinary page tests use Edge with simulated messaging; an additional test loads the real MV3 extension into test Chromium and exercises native Chrome APIs. Neither certifies arbitrary third-party sites. Actual site/Chrome testing remains necessary.
