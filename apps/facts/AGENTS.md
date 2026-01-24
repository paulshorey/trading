# Facts.News App

A "coming soon" landing page for Facts.News - a platform for unbiased, fact-based news.

## Purpose

Facts.News aims to provide:

- No nonsense news reporting
- No political bias or pandering
- Down to business lists of facts, events, and statistics
- Information for sharing with those who need factual data

## Structure

- `app/` - Next.js 14 App Router structure
  - `page.tsx` - Main landing page with centered content and contact form
  - `layout.tsx` - Root layout with Mantine provider
  - `globals.css` - Global styles and Tailwind CSS
  - `api/contact/` - API route for contact form submissions

## Features

### Landing Page

- Fully responsive centered design
- Works seamlessly on mobile and desktop
- Beautiful gradient background
- Modern UI with Mantine components

### Contact Form

- Name, email, and message fields
- Client-side validation
- Form submission via POST to `/api/contact`
- Success/error feedback to user

### API Endpoint

- **POST /api/contact** - Handles contact form submissions
- Validates input data
- Logs submissions (ready for email/database integration)
- Returns success/error responses

## Configuration

Uses shared configs from `@lib/config`:

- TypeScript config extends `@lib/config/typescript/nextjs.json`
- Next.js config extends `@lib/config/next/base`
- PostCSS config from `@lib/config/postcss`
- Tailwind config from `@lib/config/tailwind/app`

## Development

```bash
pnpm dev    # Run on localhost:3334
pnpm build  # Production build
pnpm start  # Start production server
```

## Future Enhancements

- Integrate email service for contact form
- Save submissions to database
- Add notification service
- Analytics tracking
- Deploy to facts.news domain
