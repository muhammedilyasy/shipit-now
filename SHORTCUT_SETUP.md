# ShipIt Checker iOS Shortcut Setup

Use this API URL:

```text
https://shipit-checker.muhammedilyasyp.workers.dev/check?username=muhammedilyasy&tz=Asia/Kolkata
```

## Shortcut: ShipIt Checker

Create a new Shortcut named:

```text
ShipIt Checker
```

Add these actions in this exact order.

### 1. URL

Paste:

```text
https://shipit-checker.muhammedilyasyp.workers.dev/check?username=muhammedilyasy&tz=Asia/Kolkata
```

### 2. Get Contents of URL

Leave it as `GET`.

### 3. Get Dictionary Value

Set the key to:

```text
shipped
```

This action extracts `yes` or `no` from the API response.

### 4. If

Set it like this:

```text
If Dictionary Value is no
```

In Shortcuts, it may look like:

```text
If [Value from Dictionary] [is] [no]
```

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

## Final Shape

Your Shortcut should visually look like this:

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

## Automation 1: Sleep Focus

Create a Personal Automation:

```text
When Sleep Focus turns on
Run Immediately
```

Actions:

```text
Repeat 10 times
    Wait 60 seconds
End Repeat
Run Shortcut: ShipIt Checker
```

## Automation 2: Alarm Dismissed

Create another Personal Automation:

```text
When alarm Ship Check is dismissed
Run Immediately
```

Action:

```text
Run Shortcut: ShipIt Checker
```

## Important

The alarm label must be exactly:

```text
Ship Check
```

If the label is different, the alarm-dismissed automation will not loop correctly.
