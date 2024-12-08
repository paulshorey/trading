/**
 * Returns tuple of 3 values: [phone, email, message]
 * First 2 could both be empty if neither a valid phone or email.
 * Third value is an error message. It tries to guess phone or email, but don't rely on this.
 */
export default function phoneOrEmail(string: string) {
  const error = 'Invalid phone or email format. Should be: +1 555 555-5555 or hey@example.com';
  const errorEmail = 'Invalid email format. Should be: hey@example.com';
  const errorPhone = 'Invalid phone number. Should be: +1 555 555-5555';
  const digits = string.replace(/[^0-9]+/g, '');
  const letters = string.replace(/[^a-z@]+/gi, '');
  const email = string || '';
  console.log(
    ['phoneOrEmail'],
    string,
    [digits, typeof digits],
    [letters, typeof letters],
    [email, typeof email]
  );
  if (digits.length > letters.length) {
    if (digits.length > 10 && digits.length < 15) return [`+${digits}`, '', '']; // how long can a country code be?
    if (digits.length == 10) return [`+1${digits}`, '', '']; // assume US or Canada. If wrong, backend will reject
    if (digits.length < 10) return ['', '', errorPhone];
    return ['', '', errorPhone];
  }
  if (email) {
    if (/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      // emails can be very complex. This is only a very simple check
      return ['', email, ''];
    }
    if (letters.length > 1) {
      return ['', '', errorEmail];
    }
  }
  return ['', '', error];
}
