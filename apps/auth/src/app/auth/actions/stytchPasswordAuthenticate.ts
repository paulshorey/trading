'use server';

import { Client } from 'stytch';
import { sessionStart } from '@src/app/auth/actions/session';
import { SessionData, sessionDataFromStytchResponse } from '@src/app/auth/actions/types';

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || '',
  secret: process.env.STYTCH_SECRET || '',
});

type responseType = {
  status_code: number;
  message?: string;
  session?: SessionData;
};

export default async function stytchPasswordAuthenticate(post: {
  email: string;
  password: string;
}): Promise<responseType> {
  console.error('\n\n\n', ['stytchPasswordAuthenticate'], '\n', post, '\n\n\n');
  try {
    const data = await stytchClient.passwords.authenticate({
      email: post.email,
      password: post.password,
    });
    const session = await sessionStart(sessionDataFromStytchResponse(data));
    return { session, status_code: data.status_code };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message, status_code: 500 };
  }
}
