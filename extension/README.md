# Companion maintenance

The app creates a ZIP from the source files in this directory. The ZIP pins the app's current origin. It contains no wildcard hosting permission. Chrome grants content scripts access to the official MDAC main path. The background also requires the exact registration URL, top frame, bound tab, document ID, and attempt ID.

The app bridge accepts only hello, start, cancel, and ack. A start contains an immutable profile and trip snapshot. It cannot provide URLs, scripts, or selectors. The extension holds one active job. Active personal data lives in chrome.storage.session. Durable chrome.storage.local holds attempt IDs, sender bindings, and unacknowledged events. The app persists each event before sending ACK. A page reload replays the journal. A new app tab can adopt the job only after the old owner tab closes.

Before a native click, the adapter requires a trusted pointer drag and a later transition to the official slider success class. Submit starts enabled on the observed form, so enabled state alone is insufficient. The background persists click_intent, waits for the app's ACK, then persists a single dispatch permission. The adapter checks the arrival window and reads the whole form again before clicking. Failures after intent remain unknown. No receipt parser exists. A user must check the official Check Registration page and record a reference in the app.

A blocked or cancelled attempt may run again only if no click intent occurred. An attempted click ID cannot run again through the companion. Cancellation cannot undo a click. Browser session loss produces blocked or unknown according to the last persisted phase. The extension never marks a record confirmed.

## Install

Download Companion from MDAC Desk. Extract the ZIP to a permanent folder. Open chrome://extensions, enable Developer mode, and select Load unpacked. Choose the extracted folder, then reload MDAC Desk. Download and install a new ZIP if the app origin changes. This is an unpacked installation artifact, not a Chrome Web Store listing.

## Checks

Run npm test for adapter tests. Run node scripts/build-companion.mjs before dev or build to copy the production adapter into the local fixture. Open /fixture.html to test the adapter without the extension or government traffic. Use test values only.

For the extension workflow, start npm run dev on port 5173, then run node tests/extension-e2e.mjs. Set MDAC_TEST_ORIGIN if the local port differs. Install the Playwright Chromium browser with npx playwright install chromium if needed. The test downloads the real ZIP through the app client, extracts a separate test copy, and replaces its official URL and match pattern with a second loopback origin. The production ZIP stays intact. The test blocks all government requests. It checks real extension loading, sender binding, journal replay after reload, a trusted pointer drag, withheld ACK preventing a click, one native click, unknown state retention, and retry restrictions.

Official dropdown replacements are observed before dependent values are set. Missing controls, unavailable codes, a timed-out replacement, changed values, and changed documents stop the attempt. Changes to the government's HTML or validation may need an adapter update. The fixture proves the local workflow; it does not prove that the government accepted a registration.
