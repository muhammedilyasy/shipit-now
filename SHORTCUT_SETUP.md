# ShipIt Checker iOS Shortcut Setup

First deploy your own Worker using the button in `README.md`.

Then use your own API URL:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE
```

Example format:

```text
https://your-worker.workers.dev/check?username=octocat&tz=Asia/Kolkata
```

Do not use someone else's demo Worker for daily use. Deploy your own so you do not share rate limits.

## Shortcut: ShipIt Checker

Create a new Shortcut named:

```text
ShipIt Checker
```

Add these actions in this exact order.

### 1. URL

Paste your own Worker URL:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/check?username=YOUR_GITHUB_USERNAME&tz=YOUR_TIMEZONE
```

### 2. Get Contents of URL

Leave it as `GET`.

### 3. Get Dictionary Value

Set the key to:

```text
shipped
```

This extracts `yes` or `no` from the API response.

### 4. If

Set it like this:

```text
If Dictionary Value is no
```

If Shortcuts shows file size, MB, URL, or anything else, the If block is using the wrong input. Delete the If block, add it again directly after `Get Dictionary Value`, and select `Dictionary Value`.

Everything between `If` and `Otherwise` happens when you did not ship.

Everything between `Otherwise` and `End If` happens when you did ship.

## Inside the If Block

Put these actions directly under the `If` line, before `Otherwise`.

### 5. Adjust Date

Set:

```text
Add 1 minute to Current Date
```

### 6. Create Alarm

Use the adjusted date as the alarm time.

Set the alarm label exactly:

```text
Ship Check
```

### 7. Play Sound

Pick any sound.

### 8. Show Notification

Text:

```text
No ship detected. Alarm set.
```

## Inside the Otherwise Block

Put this action after `Otherwise`, before `End If`.

### 9. Show Notification

Text:

```text
Streak safe. Sleep well.
```

## Final Shortcut Shape

```text
URL
Get Contents of URL
Get Dictionary Value for shipped

If Dictionary Value is no
    Adjust Date: Add 1 minute to Current Date
    Create Alarm at Adjusted Date named Ship Check
    Play Sound
    Show Notification: No ship detected. Alarm set.
Otherwise
    Show Notification: Streak safe. Sleep well.
End If
```

Nothing goes after `End If`.

## Automation: Basic Mode

This is the recommended setup.

Create a Personal Automation:

```text
Time of Day
```

Choose your bedtime, for example:

```text
11:00 PM
```

Set:

```text
Repeat Daily
Run Immediately
```

Action:

```text
Run Shortcut: ShipIt Checker
```

This checks once each night. If you have not shipped, it creates a `Ship Check` alarm.

## Automation: Optional Hardcore Mode

This tries to loop after alarms are stopped.

Create another Personal Automation:

```text
Alarm
Is Stopped
Any Alarm
Run Immediately
```

Action:

```text
Run Shortcut: ShipIt Checker
```

Warning: iOS does not provide a reliable "only when the alarm named Ship Check is stopped" trigger for alarms created by a Shortcut. `Any Alarm` can also run after normal alarms, so Hardcore Mode is optional.

## Important

The alarm label created by the Shortcut should be exactly:

```text
Ship Check
```
