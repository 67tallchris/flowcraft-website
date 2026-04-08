# FlowCraft Website

A Cloudflare Workers-powered landing page for FlowCraft — an ADHD-focused coaching practice — with integrated waitlist management, tagging, and export system.

**Live Site:** https://flowcraft-website.portercoaching.workers.dev  
**Admin Dashboard:** https://flowcraft-website.portercoaching.workers.dev/admin

## Features

### Public Website
- Responsive landing page with FlowCraft branding
- Waitlist signup form with email validation
- Duplicate email detection
- Real-time form submission feedback
- Smooth scroll animations

### Admin Dashboard
Password-protected admin panel with full waitlist management:

- **Email Management**
  - View all waitlist signups in a sortable table
  - Search and filter by email, tag, or date range
  - Pagination support
  - Copy emails to clipboard

- **Tagging System**
  - Create custom tags with custom colors
  - Add/remove tags from individual emails
  - Bulk tag multiple emails at once
  - Filter emails by tag
  - Delete tags without affecting emails

- **Export System**
  - Export current view (respects active filters)
  - Export with custom filters (tag, date range)
  - Export selected emails only
  - Downloads as CSV file
  - Full export history logging with timestamps and filter details

- **Analytics**
  - Total signups count
  - Weekly and monthly signup stats
  - Total export count

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **Deployment:** Wrangler CLI
- **Frontend:** Vanilla HTML/CSS/JavaScript (no frameworks)

## Project Structure

```
flowcraft-website/
├── src/
│   └── index.js          # Main worker script (API + HTML)
├── schema.sql            # D1 database schema
├── package.json          # Dependencies and scripts
├── wrangler.toml         # Cloudflare Workers configuration
└── .gitignore            # Git ignore rules
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Cloudflare account
- Wrangler CLI

### Installation

1. Clone the repository:
```bash
git clone https://github.com/67tallchris/flowcraft-website.git
cd flowcraft-website
```

2. Install dependencies:
```bash
npm install
```

3. Login to Cloudflare:
```bash
npx wrangler login
```

### Local Development

1. Create a local D1 database:
```bash
npx wrangler d1 create flowcraft-waitlist
```

2. Update `wrangler.toml` with the new database ID.

3. Run the schema migration:
```bash
npx wrangler d1 execute flowcraft-waitlist --file=schema.sql --local
```

4. Set the admin password (optional for local dev):
```bash
npx wrangler secret put ADMIN_PASSWORD
```

5. Start the development server:
```bash
npm run dev
```

The site will be available at `http://localhost:8787`

### Deployment

1. Deploy to Cloudflare Workers:
```bash
npm run deploy
```

2. Run the schema migration on the remote database:
```bash
npx wrangler d1 execute flowcraft-waitlist --file=schema.sql --remote
```

3. Set the admin password:
```bash
npx wrangler secret put ADMIN_PASSWORD
```

## API Endpoints

### Public
- `POST /api/waitlist` — Submit email to waitlist

### Admin (requires authentication)
- `GET /api/waitlist` — Get waitlist emails with pagination and filters
- `POST /api/export` — Export emails as CSV
- `GET /api/export-logs` — Get export history
- `GET /api/tags` — Get all tags
- `POST /api/tags` — Create a new tag
- `DELETE /api/tags?id={id}` — Delete a tag
- `POST /api/email-tags` — Add tag to email
- `DELETE /api/email-tags` — Remove tag from email
- `POST /api/admin/login` — Admin login
- `POST /api/admin/logout` — Admin logout
- `GET /api/admin/verify` — Verify admin session

## Admin Dashboard Usage

### Logging In
1. Navigate to `/admin`
2. Enter the admin password (default: `flowcraft-admin-2024`)

### Managing Tags
1. Go to the "Manage Tags" tab
2. Create a new tag with a name and color
3. Tags can be added to emails from the Emails tab

### Exporting Emails
1. **Quick Export:** Click "Export Current View" to export with active filters
2. **Filtered Export:** Click "Export with Filters" to set custom filters
3. **Selected Export:** Select specific emails and click "Export Selected"

All exports are logged in the "Export Logs" tab with timestamps and filter details.

### Filtering Emails
- **Search:** Type to search emails by email address
- **Tag Filter:** Select a tag to show only emails with that tag
- **Date Range:** Set "From" and "To" dates to filter by signup date

## Changing the Admin Password

```bash
npx wrangler secret put ADMIN_PASSWORD
```

You'll be prompted to enter the new password.

## Database Schema

The D1 database has four tables:

- `waitlist_emails` — Email signups with timestamps
- `tags` — Custom tags with colors
- `email_tags` — Junction table linking emails to tags
- `export_logs` — Log of all exports with filters used

## Scripts

- `npm run dev` — Start local development server
- `npm run deploy` — Deploy to Cloudflare Workers

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
