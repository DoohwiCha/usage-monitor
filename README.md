# Usage Monitor

Monitor **Claude** and **OpenAI** multi-account usage in a single dashboard.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, and Framer Motion.

![Landing Page](docs/screenshots/01-landing-dark.png)

---

## Features

- **Multi-Account Support** — Monitor up to 12 Claude and OpenAI accounts simultaneously
- **Real-time Usage Tracking** — Auto-refresh every 60 seconds with background updates
- **Rate Limit Monitoring** — Visualize Claude usage windows (5h, 7d) with progress bars
- **Browser Login** — One-click Claude/OpenAI login via Playwright (auto-saves session cookies)
- **Dark / Light Theme** — Beautiful glass-morphism UI with theme toggle
- **6 Languages** — English, Korean, Japanese, Chinese, Spanish, Portuguese
- **Secure** — AES-256-GCM encryption, HMAC sessions, CSRF protection, CSP headers

---

## Screenshots

### Landing Page

Service introduction with dashboard preview mockup.

| Dark | Light |
|------|-------|
| ![Landing Dark](docs/screenshots/01-landing-dark.png) | ![Landing Light](docs/screenshots/02-landing-light.png) |

### Login

Admin authentication with gradient brand styling.

![Login](docs/screenshots/03-login.png)

### Dashboard

Real-time usage overview with provider grouping and utilization bars.

| Dark | Light |
|------|-------|
| ![Dashboard Dark](docs/screenshots/04-dashboard-dark.png) | ![Dashboard Light](docs/screenshots/05-dashboard-light.png) |

### Account Management

Add, reorder, enable/disable, and delete accounts.

![Accounts](docs/screenshots/06-accounts.png)

### Account Detail

Per-account settings, browser login, connection testing, and daily usage table.

![Account Detail](docs/screenshots/07-account-detail.png)

### Internationalization

All UI text is translated. Example in Japanese:

![Japanese](docs/screenshots/08-i18n-japanese.png)

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- (Optional) **Playwright** for browser-based login

### Installation

```bash
git clone https://github.com/DoohwiCha/usage-monitor.git
cd usage-monitor
npm install
```

### Environment Variables

Copy the example file and configure:

```bash
cp .env.example .env.local
```

| Variable | Description | Required |
|----------|-------------|----------|
| `MONITOR_ADMIN_USER` | Admin username | Yes (production) |
| `MONITOR_ADMIN_PASS` | Admin password (min 8 chars) | Yes (production) |
| `MONITOR_SESSION_SECRET` | HMAC session signing key | Yes (production) |
| `MONITOR_ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM | Yes (production) |

Generate an encryption key:

```bash
openssl rand -hex 32
```

> **Development defaults**: `admin` / `admin1234` (only in `NODE_ENV !== "production"`)

### Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000)

### Browser Login (Optional)

To use one-click browser login for Claude/OpenAI:

```bash
npx playwright install chromium
```

---

## Architecture

```
usage-monitor/
├── app/                        # Next.js App Router
│   ├── page.tsx                # Landing page
│   ├── layout.tsx              # Root layout (LocaleProvider, ErrorBoundary)
│   ├── monitor/
│   │   ├── page.tsx            # Dashboard
│   │   ├── login/page.tsx      # Login page
│   │   └── accounts/
│   │       ├── page.tsx        # Account manager
│   │       └── [id]/page.tsx   # Account detail
│   └── api/monitor/            # REST API routes
│       ├── auth/               # Login, logout, session check
│       ├── accounts/           # CRUD + reorder + connect test
│       └── usage/              # Usage data aggregation
├── components/monitor/         # UI components
│   ├── MonitorDashboard.tsx    # Main dashboard
│   ├── AccountsManager.tsx     # Account list & add form
│   ├── AccountDetail.tsx       # Per-account settings & usage
│   ├── LoginForm.tsx           # Login form
│   ├── shared.tsx              # ToggleSwitch, Spinner, brandVar
│   ├── ErrorBoundary.tsx       # React error boundary
│   ├── ThemeToggle.tsx         # Dark/light toggle
│   └── LanguageSelector.tsx    # i18n language picker
├── lib/
│   ├── i18n/                   # Internationalization
│   │   ├── translations.ts     # 6 languages, ~100 keys each
│   │   └── context.tsx         # React context + useTranslation
│   └── usage-monitor/
│       ├── types.ts            # TypeScript types
│       ├── store.ts            # JSON file store + AES encryption
│       ├── auth.ts             # HMAC session auth
│       ├── api-auth.ts         # API route auth + CSRF
│       ├── server-auth.ts      # Server component auth
│       ├── usage-adapters.ts   # Claude/OpenAI API adapters
│       └── range.ts            # Date range utilities
├── middleware.ts               # Edge auth middleware
├── data/                       # Account data (gitignored)
└── docs/screenshots/           # App screenshots
```

---

## Security

| Feature | Implementation |
|---------|---------------|
| Authentication | HMAC-SHA256 signed session tokens (12h TTL) |
| Password | Timing-safe comparison, production enforcement |
| Encryption | AES-256-GCM for stored secrets (cookies, API keys) |
| CSRF | Origin + Referer header validation |
| Headers | CSP, HSTS, X-Frame-Options DENY, X-Content-Type nosniff |
| File permissions | Store file set to `0o600` |
| Secrets in API | Masked in all responses (`****` + last 4 chars) |

---

## Supported Providers

| Provider | Auth Method | Data Source |
|----------|------------|-------------|
| **Claude** | Browser login (Playwright) or manual cookie | claude.ai internal API (rate limits, utilization) |
| **OpenAI** | Admin API Key (`sk-admin-...`) or browser login | OpenAI Admin API (costs, requests, tokens) |

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Framer Motion](https://www.framer.com/motion/)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/) (strict mode)
- **Browser Automation**: [Playwright](https://playwright.dev/) (optional)

---

## License

MIT
