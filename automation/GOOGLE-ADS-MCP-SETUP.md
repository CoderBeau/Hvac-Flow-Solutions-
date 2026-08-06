# Google Ads MCP — Setup Runbook

Start to finish. Every step says **where to click** and **where to paste what you copied**.

Do this on your own computer, in a terminal. The MCP server is a local process — it cannot run from a Claude Code web session.

**Time:** ~90 minutes of work, plus 1–3 days waiting on Google to approve the developer token.

Keep a scratch note open. Six values get copied in one step and pasted in another:

| # | Value | Copied in | Pasted in |
|---|---|---|---|
| 1 | Manager account (MCC) ID | Step 1 | Step 7 |
| 2 | Developer token | Step 2 | Step 7 |
| 3 | Ads account customer ID | Step 3 | Step 7 |
| 4 | Cloud project ID | Step 4 | Step 7 |
| 5 | OAuth client ID + secret | Step 5 | Step 6 |
| 6 | Conversion action resource names | Step 9 | `account-config.md` |

---

## Step 1 — Manager account (MCC)

Developer tokens are issued to *manager* accounts. A regular ads account cannot get one.

1. Go to **https://ads.google.com/home/tools/manager-accounts**
2. Click **Create a manager account**. It's free.
3. Name it `HVAC Flow Solutions – Manager`. Country **United States**, currency **USD**, time zone **(GMT-06:00) Central Time**.

> Currency and time zone are **permanent**. Getting the time zone wrong makes every dayparting rule and daily budget reset at the wrong hour. Central Time.

4. **📋 COPY #1:** the ID at the top right, format `123-456-7890`.

Link your existing ads account: in the manager account → **Accounts → Sub-account menu (+) → Link existing account** → enter the customer ID → the ads account gets a notification → accept it under **Admin → Access and security → Managers**.

## Step 2 — Developer token

1. In the **manager account** (not the ads account) → **Tools** (wrench icon) → **Setup → API Center**
2. Fill in the API access form. Company name `HVAC Flow Solutions`, website `https://boosthvacleads.com`.
3. For intended use, describe it accurately — you manage your own advertising, you are not building a tool for other advertisers:

   > Internal use only. We manage our own Google Ads campaigns for our lead generation business. We use the API to pull search term and campaign performance reports and to make routine campaign changes such as adding negative keywords and adjusting budgets. We do not provide any tool, interface, or service to third-party advertisers.

   That last sentence matters — it's what keeps you out of Required Minimum Functionality, which only applies to Standard Access tokens held by developers serving third parties.

4. Accept the terms. You get a token immediately at **Test Account** level.
5. **📋 COPY #2:** the developer token.
6. Click **Apply for Explorer access** (or Basic). You need at least Explorer to touch a live account.

| Level | Ops/day | Live accounts? |
|---|---|---|
| Test | — | No |
| **Explorer** | 2,880 | **Yes — enough to start** |
| Basic | 15,000 | Yes |
| Standard | Uncapped | Yes |

Explorer is enough for one market. A full campaign build is roughly 60–100 operations. Move to Basic when you add a second and third metro.

While the application is pending, continue with Steps 3–8 — everything else can be set up in advance.

## Step 3 — Ads account customer ID

Open the HVAC Flow Solutions ads account (the one that will run the campaigns).

**📋 COPY #3:** the customer ID at the top right, `123-456-7890`.

If you don't have an ads account yet, create one from the manager account: **Accounts → (+) → Create new account**. Same currency and time zone as Step 1. When it offers Smart Mode, choose **Switch to Expert Mode** — Smart Mode has no API access and no campaign controls.

## Step 4 — Google Cloud project

```bash
gcloud projects create hvacflow-ads-api
gcloud config set project hvacflow-ads-api
gcloud services enable googleads.googleapis.com
```

Or in the console: **https://console.cloud.google.com** → project dropdown → **New Project** → then **APIs & Services → Library** → search `Google Ads API` → **Enable**.

**📋 COPY #4:** the project ID (not the display name — the ID, which may have a numeric suffix).

## Step 5 — OAuth client

1. **APIs & Services → OAuth consent screen**
   - User type **External** → **Create**
   - App name `HVAC Flow Ads MCP`, support email `hvacflowsolutions@gmail.com`, developer contact the same
   - **Save and Continue** through Scopes (add none — the server requests what it needs)
   - **Test users → Add users** → add `hvacflowsolutions@gmail.com`
   - Leave publishing status as **Testing**

> Testing mode means the refresh token expires every 7 days and you re-run Step 6's token script. Annoying but harmless. Publishing to Production stops the expiry but triggers Google's verification review because the Ads scope is sensitive. Stay in Testing until the 7-day cycle actually bothers you.

2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type **Desktop app**
   - Name `mcp-google-ads`
   - **Create** → **📋 COPY #5:** client ID and client secret, and click **Download JSON**

## Step 6 — Build and authorize the server

```bash
git clone https://github.com/FGRibreau/mcp-google-ads.git
cd mcp-google-ads
cargo build --release
```

Needs Rust. If `cargo` is missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

**📥 PASTE #5 (the downloaded JSON):**

```bash
mkdir -p ~/.mcp-google-ads
cp ~/Downloads/client_secret_*.json ~/.mcp-google-ads/credentials.json
```

Generate the refresh token:

```bash
./scripts/generate_token.sh
```

A browser opens. Sign in as `hvacflowsolutions@gmail.com` and approve. Google shows a scary "Google hasn't verified this app" screen — that is your own app in Testing mode. Click **Advanced → Go to HVAC Flow Ads MCP (unsafe)**. The token is written to `~/.mcp-google-ads/token.json`.

## Step 7 — Register with Claude Code

**📥 PASTE #1, #2, #3 here.** Substitute your real values:

```bash
claude mcp add --transport stdio google-ads --scope user \
  --env GOOGLE_ADS_DEVELOPER_TOKEN=PASTE_COPY_2_HERE \
  --env GOOGLE_ADS_CUSTOMER_ID=PASTE_COPY_3_HERE \
  --env GOOGLE_ADS_LOGIN_CUSTOMER_ID=PASTE_COPY_1_HERE \
  --env GOOGLE_ADS_CREDENTIALS_PATH="$HOME/.mcp-google-ads/credentials.json" \
  --env GOOGLE_ADS_TOKEN_PATH="$HOME/.mcp-google-ads/token.json" \
  --env GOOGLE_ADS_MAX_DAILY_BUDGET=150 \
  --env GOOGLE_ADS_MAX_BID_INCREASE_PCT=50 \
  --env GOOGLE_ADS_REQUIRE_DRY_RUN=true \
  --env GOOGLE_ADS_AUDIT_LOG="$HOME/.mcp-google-ads/audit.log" \
  -- $HOME/mcp-google-ads/target/release/mcp-google-ads
```

Notes:
- `GOOGLE_ADS_CUSTOMER_ID` is the **ads account**; `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is the **manager account**. Swapping them is the most common failure.
- `--scope user` makes it available in every project, not just this repo. Correct here — the token is yours, not the repo's.
- **These env vars never go in a file in this repo.** This repo is public.

Verify:

```bash
claude mcp list          # google-ads → ✔ Connected
```

Then in a Claude Code session, from this repo:

```
Use list_accessible_customers to show my Google Ads accounts.
```

If that returns your customer ID, the whole chain works.

## Step 8 — Confirm the skill loads

```
/campaign-ops
```

`.claude/skills/campaign-ops/` is committed in this repo, so it loads automatically for anyone working in it.

## Step 9 — Conversion tracking

Do this **before** launching anything. A campaign without conversion tracking is money spent to learn nothing, and Maximize Conversions bidding literally cannot function.

In the **ads account** → **Goals → Conversions → + New conversion action**

**A. Quote Form Submit**
- Source **Website** → enter `boosthvacleads.com`
- Category **Submit lead form**
- Conversion name `Quote Form Submit`
- Value **Use the same value for each conversion → $15** (what a routed lead is actually worth — package math is in `SETUP.md`)
- Count **One**
- Set up with **Google Tag** → rule-based, fires on page load where **URL contains `/thanks.html`**
- Mark **Primary**

**B. Phone Call from Ad**
- Source **Phone calls** → **Calls from ads**
- Call length **60 seconds**
- Name `Phone Call from Ad`
- Value **$15**, count **One**
- Mark **Primary**

**C. Website Call Click**
- Source **Phone calls** → **Calls to a phone number on your website**
- Name `Website Call Click`
- Mark **Secondary** — it double-counts against the form on mobile

Install the Google tag on the site: **Goals → Conversions → Google tag → Installation instructions → Install manually.** Copy the snippet and paste it into the `<head>` of `index.html`, `get-quotes.html`, and `thanks.html`.

**📥 PASTE #6:** put the three conversion action resource names into `.claude/skills/campaign-ops/references/account-config.md`, along with copies #1, #3, and #4. Fill in every `<FILL IN>`.

## Step 10 — Local Services Ads (do this in parallel)

LSA cannot be created through the API — the campaign type is unsupported for creation. Set it up by hand; it's usually the cheapest HVAC lead source in San Antonio.

**https://ads.google.com/local-services-ads** → sign up → San Antonio, category HVAC. Google Guaranteed verification needs your license, insurance certificate, and a background check. Budget 2–3 weeks.

Once it exists, the API can manage its budget, schedule, bidding, and location targeting — so Claude can run it day to day even though it couldn't create it.

---

## Launch

With Steps 1–9 done:

```
Build the San Antonio emergency AC repair campaign, $80/day.
```

Claude will design it with `hvac-ad-campaign`, show you the package, build it PAUSED via the MCP server, show you the preview, and wait. Nothing goes live until you say so.

Then:

```
Write the blog post for "ac not cooling san antonio" and publish it.
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DEVELOPER_TOKEN_NOT_APPROVED` | Still Test level | Wait for Explorer/Basic approval |
| `CUSTOMER_NOT_ENABLED` | Ads account not fully set up | Add billing in the ads account |
| `USER_PERMISSION_DENIED` | Manager not linked, or IDs swapped | Confirm the link; check #1 vs #3 |
| `invalid_grant` | Refresh token expired (7-day Testing cycle) | Re-run `./scripts/generate_token.sh` |
| Server shows ✘ in `claude mcp list` | Bad binary path | `ls $HOME/mcp-google-ads/target/release/mcp-google-ads` |
| `RESOURCE_EXHAUSTED` | Daily op cap hit | Apply for Basic (15,000/day) |
| Budget change rejected | Above `GOOGLE_ADS_MAX_DAILY_BUDGET` | Deliberately raise the env var, then re-add the server |

**Rotate the developer token immediately** if it ever lands in a commit, a screenshot, or a support ticket: manager account → API Center → regenerate. Anyone holding it can spend your money.
