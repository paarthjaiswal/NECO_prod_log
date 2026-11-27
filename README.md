<!-- PORTFOLIO_OVERVIEW_START -->
NECO AMD is a shop-floor production and downtime tracker for recording shift-level output, rework, and machine breakdowns. It combines a Next.js App Router dashboard and server actions with Supabase-backed data access, while a TypeScript analytics engine derives production and OEE metrics.
<!-- PORTFOLIO_OVERVIEW_END -->

<!-- PORTFOLIO_HIGHLIGHTS_START -->
- **Highlight 1:** Calculates availability, performance, quality, OEE, and plan achievement from production and downtime records.
- **Highlight 2:** Uses server-side Supabase clients for session-aware access and elevated data operations, with reporting organized around shifts, lines, machines, and products.
- **Highlight 3:** Provides Excel and CSV export utilities, with npm scripts for development, linting, production builds, and serving.
<!-- PORTFOLIO_HIGHLIGHTS_END -->

# NECO AMD Production Log

Shift production and downtime tracking for the Automotive & Machining Division.

## Tech Stack

- Next.js 15 with the App Router and React 19
- TypeScript and Tailwind CSS 4
- Supabase JavaScript client and Supabase SSR
- `xlsx` and `xlsx-js-style` for spreadsheet exports
- Lucide React icons

## Architecture and Key Features

The home page loads factory time, master data, and the active shift's records on the server, then passes that data to the client-side dashboard. Server actions handle data operations through Supabase clients; the session client uses the user's cookies, while the admin client uses a server-side secret key.

Shift records cover production output, rework, and categorized downtime. The TypeScript analytics engine calculates availability, performance, quality, OEE, and plan achievement, and groups results for machine, line, product, shift, and period views. Export utilities generate Excel workbooks and CSV data.

## Local Setup and Run

Use Node.js with npm and configure a Supabase project for the application.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Create `.env.local` in the repository root and provide your Supabase credentials:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_SECRET_KEY=your-supabase-secret-key
   ```

   The application also accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` instead of `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep `SUPABASE_SECRET_KEY` server-side; do not expose it in browser code.

3. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

Other available commands:

```bash
npm run lint
npm run build
npm run start
```

Run `npm run build` before `npm run start` to create the production build.
