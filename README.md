# ShipIt Checker

A Cloudflare Worker + iOS Shortcut that checks if you shipped on GitHub today before bed. If you didn't, it sets an alarm to nudge you.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/muhammedilyasy/shipit-now)

## Quick Start

1. **Deploy the Worker** using the button above.
2. **[Download the Shortcut](https://www.icloud.com/shortcuts/c31b2a50c213486297d5ee84c79a021d)** to your iPhone.
3. Open the Shortcut and paste your Worker URL.
4. Create a **Sleep** automation that runs the shortcut (see below).

## What It Does

1. A **Sleep** automation triggers the shortcut each night when you wind down for bed.
2. The shortcut calls your Cloudflare Worker.
3. The Worker checks your GitHub contribution calendar.
4. If you haven't shipped (`shipped: "no"`), the shortcut creates a `Ship Check` alarm to nudge you.

## API

```text
GET /check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE
```

Example:

```text
https://your-worker.workers.dev/check?username=octocat&tz=Asia/Kolkata
```

Optional parameters:

- `date=YYYY-MM-DD`: checks a specific date instead of calculating today.
- `tz=Area/City`: timezone used when `date` is omitted.

Response fields:

- `shipped`: `"yes"` or `"no"`; this is the field the iOS Shortcut should use.
- `contributedToday`: boolean version of the same result.
- `contributionCount`: contribution count when available.
- `method`: `"graphql"` when `GITHUB_TOKEN` is configured, otherwise `"scrape"`.

## Configuration

Set optional defaults in `wrangler.toml`:

```toml
[vars]
DEFAULT_TIMEZONE = "Asia/Kolkata"
DEFAULT_GITHUB_USERNAME = "your-github-username"
```

## Private Contributions

Without a token, the Worker only sees public contributions. To include private ones, add a GitHub personal access token as a Cloudflare Worker secret:

```bash
npx wrangler secret put GITHUB_TOKEN
```

## iOS Shortcut Setup

**[Download the pre-built Shortcut](https://www.icloud.com/shortcuts/c31b2a50c213486297d5ee84c79a021d)** from iCloud — no need to build it manually.

After downloading, open the shortcut and replace the URL in the first action with your own Worker endpoint:

```text
https://your-worker.workers.dev/check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE
```

The shortcut already contains all the logic: it calls your Worker, checks the `shipped` field, and if it's `no`, creates a `Ship Check` alarm.

### How the shortcut works internally

1. Calls your Worker URL.
2. Extracts `shipped` from the JSON response.
3. If `shipped` is `no`:
   - Adds 1 minute to current time.
   - Creates an alarm named `Ship Check` at that time.
   - Plays a sound and shows a notification.
4. If `shipped` is `yes`:
   - Shows a "Streak safe" notification.

## iOS Automation (Sleep Trigger)

Create a Personal Automation in the Shortcuts app:

1. **Trigger:** Sleep → Wind Down Begins (or Bedtime Begins).
2. **Action:** Run Immediately → select `ShipIt Checker`.

That's it. The shortcut runs each night when you start winding down for bed. If you haven't shipped, it sets a nudge alarm.

**Why Sleep instead of Time of Day?** Sleep trigger ties to your actual bedtime routine. If you stay up late, the check still runs before you sleep rather than at a fixed clock time.

## Practical Notes

- GitHub contributions can take a few minutes to appear after pushing.
- The alarm label must be exactly `Ship Check`.
- If your day boundary matters, pass `tz=Your/Timezone` or have the Shortcut pass `date=yyyy-MM-dd`.
- iOS does not allow distributing Personal Automations as downloadable Shortcuts — users must create the Sleep automation themselves.
- This is a fun accountability tool, not a security system. Sleep well.
