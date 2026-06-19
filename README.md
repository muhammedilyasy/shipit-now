# ShipIt Checker

A small Cloudflare Worker plus iOS Shortcuts loop that checks whether you contributed on GitHub today before letting you sleep.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/muhammedilyasy/shipit-now)

## What It Does

ShipIt Checker is a fun accountability setup:

1. An iOS Shortcut calls a Cloudflare Worker.
2. The Worker checks whether a GitHub user contributed today.
3. If the response is `shipped: "no"`, the Shortcut creates an alarm named `Ship Check`.
4. Optional hardcore mode can re-check when alarms are stopped.

Use the public demo endpoint for testing, but deploy your own Worker for daily use so you do not share rate limits with everyone else.

```text
https://shipit-checker.muhammedilyasyp.workers.dev/check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE
```

The Shortcut calls the Worker. The Worker checks GitHub's contribution calendar and returns:

```json
{
  "shipped": "yes"
}
```

or:

```json
{
  "shipped": "no"
}
```

If the Shortcut receives `no`, it creates a `Ship Check` alarm. When that alarm is dismissed, an iOS Automation runs the Shortcut again.

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

## Deploy Your Own Worker

The easiest way is the deploy button at the top of this README.

Manual deploy:

```bash
npm install
npx wrangler deploy
```

Optional: set a default timezone in `wrangler.toml`:

```toml
[vars]
DEFAULT_TIMEZONE = "Asia/Kolkata"
```

Optional: set a default GitHub username if you want `/check` to work without a `username` query parameter:

```toml
[vars]
DEFAULT_TIMEZONE = "Asia/Kolkata"
DEFAULT_GITHUB_USERNAME = "your-github-username"
```

## Private Contributions

Without a token, the Worker uses GitHub's public contribution calendar. That is easiest for a fun public project, but it only sees public contribution data.

To include private contributions, create a GitHub personal access token that can read your contribution data and add it as a Cloudflare Worker secret:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Then deploy again:

```bash
npx wrangler deploy
```

## iOS Shortcut Setup

See [SHORTCUT_SETUP.md](./SHORTCUT_SETUP.md) for the exact step-by-step iPhone setup.

Create a Shortcut named `ShipIt Checker`.

Actions:

1. URL:
   `https://your-worker.workers.dev/check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE`
2. Get Contents of URL.
3. Get Value from Dictionary: `shipped`.
4. If `shipped` is `no`:
   - Adjust Date: add 1 minute to Current Date.
   - Create Alarm: adjusted date, label `Ship Check`.
   - Play Sound.
   - Show Notification: `No ship detected. Alarm set.`
5. Otherwise:
   - Show Notification: `Streak safe. Sleep well.`

## iOS Automations

Create two Personal Automations.

Sleep trigger:

1. Trigger: Sleep Focus turns on.
2. Set to Run Immediately.
3. Repeat 10 times:
   - Wait 60 seconds.
4. Run Shortcut: `ShipIt Checker`.

Snooze loop:

1. Trigger: Alarm named `Ship Check` is dismissed.
2. Set to Run Immediately.
3. Run Shortcut: `ShipIt Checker`.

## Practical Notes

- GitHub contributions can take a short time to appear.
- The alarm loop depends on iOS Shortcuts and alarm automation behavior, so it is good for a fun accountability project, not a security system.
- Keep the alarm name exactly `Ship Check`; the automation depends on it.
- If your day boundary matters, pass `tz=Your/Timezone` or have the Shortcut pass `date=yyyy-MM-dd`.
- iOS does not let projects distribute Personal Automations as a normal downloadable Shortcut. Users can install the Shortcut, but they must create automations manually.
- Hardcore mode uses iOS's `Any Alarm` stopped trigger, which may also run after normal alarms. Treat it as optional.
