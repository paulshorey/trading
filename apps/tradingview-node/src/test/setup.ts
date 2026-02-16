/**
 * Test setup - runs before any test files via --import.
 * Ensures POSTGRES_URL is set so db module does not throw during unit tests.
 * The real pool is never used when tests inject mock getStrengthRows.
 */
if (!process.env.POSTGRES_URL) {
  process.env.POSTGRES_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";
}
