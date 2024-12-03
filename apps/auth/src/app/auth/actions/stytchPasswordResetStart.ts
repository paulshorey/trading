'use server';

import { Client } from 'stytch';

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || '',
  secret: process.env.STYTCH_SECRET || '',
});

type responseType = {
  status_code?: number;
  message?: string;
};

export default async function stytchPasswordAuthenticate(post: {
  email: string;
}): Promise<responseType> {
  console.error('\n\n\n', ['stytchPasswordAuthenticate'], '\n', post, '\n\n\n');
  try {
    const data = await stytchClient.passwords.email.resetStart({
      email: post.email,
      login_redirect_url: 'http://localhost:3000/auth/signin',
      reset_password_redirect_url: 'http://localhost:3000/auth/password-reset',
      reset_password_expiration_minutes: 10,
    });
    return { status_code: data.status_code };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message, status_code: 500 };
  }
}
