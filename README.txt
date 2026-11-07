loveeyuu v3 — Android-only GitHub Pages deployment

IMPORTANT: This is a PRIVATE BETA prototype. Real account login, opted-in discovery, mutual likes, chat and block/report storage are implemented. Reports are NOT actively moderated. Do NOT invite the public or enter real personal information until verification, moderation, and privacy reviews are complete. Bluetooth, calling, payments and original demo profiles remain simulations.

STEP 1 — SUPABASE (MUST RUN FIRST)
In your existing Supabase project open SQL Editor > New query.
Copy ALL contents of SETUP_V3.sql, paste, Run and enable RLS if prompted.
If you see an error, stop and share the error before proceeding.

STEP 2 — GITHUB
Unzip this archive. Upload the eight web files to the ROOT of your existing GitHub repository (main branch):
index.html, app.js, auth.js, live.js, sw.js, manifest.webmanifest, icon-192.png, icon-512.png.
Replace matching existing files; don't upload a nested folder. README.txt is optional. SETUP_V3.sql is for Supabase only, not for GitHub Pages.
Wait for Pages deployment and reopen the PWA. The bottom navigation now has a "Real" tab.

STEP 3 — TEST
1. Log in with your existing test account; save visibility checkbox in Real tab.
2. Create a second test account using a separate email and browser session/device, complete 18+ test profile, and opt in.
3. Discover and like each other. Refresh matches. Select Chat and exchange test messages.
4. Test block and report. Do not use real personal details.

NOTE: Existing private profiles RLS policies remain in place. discover_people() returns only opted-in fields, never birth dates. This is a functional prototype, NOT production-ready age verification or abuse prevention.
