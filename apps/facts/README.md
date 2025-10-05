# Facts.News

A "coming soon" landing page for Facts.News - No nonsense news, just facts.

## Features

- **Centered Landing Page**: Fully responsive design that works on mobile and desktop
- **Contact Form**: Functional contact form with API endpoint for collecting inquiries
- **Beautiful Design**: Modern gradient design with Mantine UI components
- **Type-Safe**: Built with TypeScript and Next.js 14

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

The app runs on `http://localhost:3334` in development mode.

## API Endpoints

### POST /api/contact

Submit a contact form message.

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Your message here"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Contact form submitted successfully"
}
```

## TODO

- [ ] Integrate email service (SendGrid, AWS SES, etc.)
- [ ] Save submissions to database
- [ ] Add notification service (Slack, Discord, etc.)
- [ ] Add analytics tracking
- [ ] Set up custom domain (facts.news)

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Mantine UI
- Tailwind CSS
- Shared configs from `@lib/config`
