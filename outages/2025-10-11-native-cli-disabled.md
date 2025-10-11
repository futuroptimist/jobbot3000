Title: Web commands 502 when native CLI disabled
Date: 2025-10-11
Impact: POST /commands/* returned 502 (Bad Gateway) from the status hub UI
Scope: Applications tab (shortlist-list endpoint) and other command routes

Summary
The web UI attempted to invoke CLI-backed endpoints without enabling native CLI execution. The server responded 502 with an error message indicating native CLI execution is disabled.

Customer Symptoms
- UI showed red error banner for Applications list
- Browser console logged 502 responses from POST /commands/shortlist-list

Root Cause
`createCommandAdapter` defaults to native CLI disabled unless JOBBOT_WEB_ENABLE_NATIVE_CLI=1 or enableNativeCli is set. The launcher script did not expose a flag to set this, and the environment variable was not present when running locally.

Detection
- Manual testing in browser
- Console 502 errors

Resolution
- Added `--enable-native-cli` flag to `scripts/web-server.js` and passed through to `startWebServer`.
- Restarted local server with the flag enabled.

Prevention
- Added regression test asserting a 502 with a clear message when native CLI is disabled.
- Documented the flag in script usage.

Related
- Reference: flywheel outages format (`https://github.com/futuroptimist/flywheel/tree/main/outages`)


