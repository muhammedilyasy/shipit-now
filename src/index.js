// src/index.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route: API check
    if (url.pathname === '/check') {
      return handleCheck(request, env);
    }

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: "shipit-checker" });
    }

    // Route: HTML Dashboard / Documentation
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return handleDashboard(request, env);
    }

    // 404 Not Found
    return jsonResponse({ error: "Not Found", status: 404 }, 404);
  }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Handles the contribution check API request.
 */
async function handleCheck(request, env) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username") || env.DEFAULT_GITHUB_USERNAME;
  const tz = url.searchParams.get("tz") || env.DEFAULT_TIMEZONE || "UTC";
  
  if (!username) {
    return jsonResponse({ error: "Missing required query parameter: username" }, 400);
  }

  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
    return jsonResponse({ error: "Invalid GitHub username" }, 400);
  }

  // Determine date to check
  let date = url.searchParams.get("date");
  if (!date) {
    try {
      date = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      // Fallback to UTC if timezone is invalid
      date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    }
  }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
  }

  const token = env.GITHUB_TOKEN;
  
  try {
    if (token) {
      // Method A: Authenticated GraphQL API (checks both public and private contributions)
      return await checkViaGraphQL(username, date, token);
    } else {
      // Method B: Public HTML Scraping (public contributions only)
      return await checkViaScraping(username, date);
    }
  } catch (error) {
    return jsonResponse({ 
      error: "Failed to check contributions", 
      details: error.message 
    }, 500);
  }
}

/**
 * Checks GitHub contribution calendar using the GraphQL API.
 */
async function checkViaGraphQL(username, date, token) {
  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  // GraphQL DateTime must be ISO-8601. We fetch a 7-day range ending today
  // to avoid timezone edge cases.
  const targetDateObj = new Date(date);
  const fromDate = new Date(targetDateObj.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = new Date(targetDateObj.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString();

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cloudflare-worker-shipit-checker"
    },
    body: JSON.stringify({
      query,
      variables: { username, from: fromDate, to: toDate }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${text}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GitHub GraphQL error: ${result.errors[0].message}`);
  }

  const user = result.data?.user;
  if (!user) {
    throw new Error(`GitHub user "${username}" not found.`);
  }

  const weeks = user.contributionsCollection?.contributionCalendar?.weeks || [];
  let contributionCount = 0;
  let found = false;

  for (const week of weeks) {
    for (const day of week.contributionDays) {
      if (day.date === date) {
        contributionCount = day.contributionCount;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const contributedToday = contributionCount > 0;

  return jsonResponse({
    username,
    date,
    contributedToday,
    shipped: contributedToday ? "yes" : "no",
    contributionCount,
    method: "graphql",
    timestamp: new Date().toISOString()
  });
}

/**
 * Checks GitHub contribution calendar by scraping the public profile contributions HTML fragment.
 */
async function checkViaScraping(username, date) {
  // Fetch only the contributions graph fragment (much faster than fetching the whole profile page)
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });

  if (response.status === 404) {
    throw new Error(`GitHub user "${username}" not found.`);
  }

  if (!response.ok) {
    throw new Error(`GitHub scrape returned status ${response.status}`);
  }

  const html = await response.text();

  // Find the td tag containing data-date="YYYY-MM-DD"
  const tdRegex = new RegExp(`<td[^>]*data-date="${date}"[^>]*>`, 'i');
  const tdMatch = html.match(tdRegex);

  if (!tdMatch) {
    // If we can't find the date, it might be too far in the future or not in the current calendar range
    return jsonResponse({
      username,
      date,
      contributedToday: false,
      shipped: "no",
      contributionCount: 0,
      method: "scrape",
      warning: "Date not found in public contribution calendar",
      timestamp: new Date().toISOString()
    });
  }

  const tdTag = tdMatch[0];
  const countMatch = tdTag.match(/data-count="(\d+)"/);
  const levelMatch = tdTag.match(/data-level="([^"]+)"/);

  if (!levelMatch && !countMatch) {
    throw new Error("Could not find contribution attributes in contribution cell.");
  }

  const contributionCount = countMatch ? parseInt(countMatch[1], 10) : null;
  const level = levelMatch ? parseInt(levelMatch[1], 10) : null;
  const contributedToday = contributionCount !== null ? contributionCount > 0 : level > 0;

  return jsonResponse({
    username,
    date,
    contributedToday,
    shipped: contributedToday ? "yes" : "no",
    contributionCount,
    method: "scrape",
    level,
    timestamp: new Date().toISOString()
  });
}

/**
 * Serves the beautiful, premium web dashboard.
 */
function handleDashboard(request, env) {
  const tokenConfigured = !!env.GITHUB_TOKEN;
  const workerUrl = new URL(request.url).origin;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShipIt Checker Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: radial-gradient(circle at 50% 0%, #16192b 0%, #090a0f 100%);
      --card-bg: rgba(20, 22, 37, 0.6);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-glow-green: rgba(16, 185, 129, 0.15);
      --card-glow-red: rgba(239, 68, 68, 0.15);
      --primary-color: #6366f1;
      --primary-glow: rgba(99, 102, 241, 0.3);
      --success-color: #10b981;
      --error-color: #ef4444;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #090a0f;
      background-image: var(--bg-gradient);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
      overflow-x: hidden;
    }

    h1, h2, h3, .font-title {
      font-family: 'Outfit', sans-serif;
    }

    header {
      text-align: center;
      margin-bottom: 3rem;
      animation: fadeIn 0.8s ease-out;
    }

    .logo {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 50%, #4338ca 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
      letter-spacing: -0.05em;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      font-weight: 400;
    }

    .container {
      max-width: 1000px;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      animation: fadeInUp 0.8s ease-out;
    }

    @media (max-width: 768px) {
      .container {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 2rem;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
    }

    .card:hover {
      border-color: rgba(99, 102, 241, 0.2);
      box-shadow: 0 12px 40px 0 rgba(99, 102, 241, 0.08);
    }

    .card-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .form-group {
      margin-bottom: 1.25rem;
    }

    label {
      display: block;
      color: var(--text-muted);
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
    }

    input, select {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 0.75rem 1rem;
      color: white;
      font-size: 1rem;
      transition: all 0.2s ease;
    }

    input:focus, select:focus {
      outline: none;
      border-color: var(--primary-color);
      background: rgba(255, 255, 255, 0.07);
      box-shadow: 0 0 0 4px var(--primary-glow);
    }

    button {
      width: 100%;
      background: var(--primary-color);
      color: white;
      border: none;
      border-radius: 12px;
      padding: 0.875rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
      box-shadow: 0 4px 12px var(--primary-glow);
    }

    button:hover {
      background: #4f46e5;
      transform: translateY(-1px);
    }

    button:active {
      transform: translateY(1px);
    }

    /* Result State Styles */
    .result-container {
      margin-top: 1.5rem;
      display: none;
    }

    .result-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      border-radius: 16px;
      margin-bottom: 1.5rem;
      text-align: center;
      font-weight: 700;
      animation: pulseGlow 2s infinite alternate;
    }

    .result-badge.shipped {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--success-color);
      box-shadow: 0 0 20px var(--card-glow-green);
    }

    .result-badge.not-shipped {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: var(--error-color);
      box-shadow: 0 0 20px var(--card-glow-red);
    }

    .badge-title {
      font-size: 1.8rem;
      font-weight: 800;
      margin-bottom: 0.25rem;
    }

    .badge-subtitle {
      font-size: 0.9rem;
      opacity: 0.8;
    }

    .result-details {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1rem;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.9rem;
    }

    .detail-row:last-child {
      border-bottom: none;
    }

    .detail-label {
      color: var(--text-muted);
    }

    .detail-value {
      font-weight: 600;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .status-badge.enabled {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success-color);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .status-badge.disabled {
      background: rgba(239, 68, 68, 0.15);
      color: var(--error-color);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    /* Steps and Documentation styling */
    .docs-section {
      margin-top: 1.5rem;
    }

    .step-item {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    .step-number {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: var(--primary-color);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.9rem;
    }

    .step-content {
      font-size: 0.95rem;
      line-height: 1.5;
    }

    .step-content strong {
      color: white;
      display: block;
      margin-bottom: 0.25rem;
    }

    .code-block {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      font-family: monospace;
      font-size: 0.85rem;
      color: #a5b4fc;
      margin-top: 0.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .copy-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 8px;
      font-size: 0.75rem;
      box-shadow: none;
      width: auto;
    }

    .copy-btn:hover {
      color: white;
      background: rgba(255,255,255,0.05);
    }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes pulseGlow {
      from { box-shadow: 0 0 10px rgba(99, 102, 241, 0.1); }
      to { box-shadow: 0 0 25px rgba(99, 102, 241, 0.25); }
    }

    .loader {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      border-top: 3px solid white;
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
      display: none;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">🚀 ShipIt Checker</div>
    <div class="subtitle">Ensuring you code every single day before bedtime.</div>
  </header>

  <div class="container">
    <!-- Test Panel -->
    <div class="card">
      <h2 class="card-title">
        <span>🔍 Test API Checker</span>
      </h2>
      <form id="checkForm" onsubmit="runTest(event)">
        <div class="form-group">
          <label for="username">GitHub Username</label>
          <input type="text" id="username" placeholder="e.g. octocat" required>
        </div>
        <div class="form-group">
          <label for="date">Target Date (Optional)</label>
          <input type="date" id="date">
        </div>
        <div class="form-group">
          <label for="tz">Timezone</label>
          <select id="tz">
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="UTC" selected>UTC</option>
          </select>
        </div>
        <button type="submit" id="submitBtn">
          <span id="btnText">Check Contributions</span>
          <div class="loader" id="btnLoader"></div>
        </button>
      </form>

      <!-- Results Display -->
      <div class="result-container" id="resultContainer">
        <div class="result-badge" id="resultBadge">
          <div class="badge-title" id="badgeTitle">SHIPPED! 🎉</div>
          <div class="badge-subtitle" id="badgeSubtitle">Found contributions today!</div>
        </div>
        <div class="result-details">
          <div class="detail-row">
            <span class="detail-label">Username</span>
            <span class="detail-value" id="resUsername">-</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Checked Date</span>
            <span class="detail-value" id="resDate">-</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Contribution Level</span>
            <span class="detail-value" id="resLevel">-</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Method</span>
            <span class="detail-value" id="resMethod">-</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Instructions / Status -->
    <div class="card">
      <h2 class="card-title">
        <span>⚙️ Configuration & Guide</span>
      </h2>
      
      <div class="form-group" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">
        <div>
          <label style="margin-bottom: 0;">Private Contributions Tracking</label>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Optional GitHub token enables GraphQL checks</span>
        </div>
        <span class="status-badge ${tokenConfigured ? 'enabled' : 'disabled'}">
          ${tokenConfigured ? 'Enabled (Token Set)' : 'Scrape Only'}
        </span>
      </div>

      <div class="docs-section">
        <h3 style="margin-bottom: 1rem; font-size: 1.1rem;">Setup iOS Shortcuts snooze loop:</h3>
        
        <div class="step-item">
          <div class="step-number">1</div>
          <div class="step-content">
            <strong>Endpoint URL</strong>
            Use this base URL for your iOS Shortcut API calls:
            <div class="code-block">
              <span id="endpointUrl">${workerUrl}/check?username=YOUR_USER&tz=YOUR_TIMEZONE</span>
              <button class="copy-btn" onclick="copyText('endpointUrl')">Copy</button>
            </div>
          </div>
        </div>

        <div class="step-item">
          <div class="step-number">2</div>
          <div class="step-content">
            <strong>Create "ShipIt Checker" Shortcut</strong>
            Open Shortcuts app and create a shortcut that:
            - Calls the URL: <code>${workerUrl}/check?username=YOUR_USER&tz=YOUR_TIMEZONE</code>.
            - Gets <code>shipped</code> from the JSON dictionary response.
            - If <code>shipped</code> is <code>no</code>: calculate <code>Current Date + 1 min</code>, set an alarm for that time labeled "Ship Check", and play a sound.
            - Advanced: pass <code>date=yyyy-MM-dd</code> only if you want the Shortcut to choose the exact local date itself.
          </div>
        </div>

        <div class="step-item">
          <div class="step-number">3</div>
          <div class="step-content">
            <strong>Configure Personal Automations</strong>
            Add two Automations in the Shortcuts app:
            - <strong>Basic mode</strong>: Time of Day → your bedtime → daily → Run Immediately → Run Shortcut <code>ShipIt Checker</code>.
            - <strong>Optional hardcore mode</strong>: Alarm → Is Stopped → Any Alarm → Run Immediately → Run Shortcut <code>ShipIt Checker</code>.
            - Hardcore mode may also run after normal alarms because iOS does not reliably target Shortcut-created alarms by label.
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Set local date as default in target date input
    document.getElementById('date').value = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    // Guess timezone
    try {
      const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const tzSelect = document.getElementById('tz');
      let found = false;
      for (let i = 0; i < tzSelect.options.length; i++) {
        if (tzSelect.options[i].value === systemTz) {
          tzSelect.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found && systemTz) {
        const opt = document.createElement('option');
        opt.value = systemTz;
        opt.text = systemTz;
        opt.selected = true;
        tzSelect.add(opt);
      }
    } catch(e){}

    function copyText(id) {
      const text = document.getElementById(id).innerText;
      navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    }

    async function runTest(e) {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const date = document.getElementById('date').value;
      const tz = document.getElementById('tz').value;
      
      const submitBtn = document.getElementById('submitBtn');
      const btnText = document.getElementById('btnText');
      const btnLoader = document.getElementById('btnLoader');
      const container = document.getElementById('resultContainer');

      // Loading state
      submitBtn.disabled = true;
      btnText.style.display = 'none';
      btnLoader.style.display = 'block';
      container.style.display = 'none';

      try {
        const url = new URL('/check', window.location.origin);
        url.searchParams.set('username', username);
        if (date) url.searchParams.set('date', date);
        if (tz) url.searchParams.set('tz', tz);

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.details || 'Check failed');
        }

        // Display results
        document.getElementById('resUsername').innerText = data.username;
        document.getElementById('resDate').innerText = data.date;
        document.getElementById('resMethod').innerText = data.method + (data.warning ? ' (Warning)' : '');
        
        let levelText = 'Unknown';
        if (data.level !== undefined) levelText = 'Level ' + data.level;
        else if (data.contributionCount !== null) levelText = data.contributionCount + ' commits';
        document.getElementById('resLevel').innerText = levelText;

        const badge = document.getElementById('resultBadge');
        const badgeTitle = document.getElementById('badgeTitle');
        const badgeSub = document.getElementById('badgeSubtitle');

        if (data.contributedToday) {
          badge.className = 'result-badge shipped';
          badgeTitle.innerText = 'SHIPPED! 🎉';
          badgeSub.innerText = 'Go to sleep, your streak is safe.';
        } else {
          badge.className = 'result-badge not-shipped';
          badgeTitle.innerText = 'NOT SHIPPED! ⚠️';
          badgeSub.innerText = 'Streak at risk! Set alarm triggered.';
        }

        container.style.display = 'block';
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
