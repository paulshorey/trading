'use server';

import { Client } from 'stytch';
import { SessionData } from '@src/app/auth/actions/types';
import { sessionEdit, sessionGet } from '@src/app/auth/actions/session';
import { responseType } from './types';

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || '',
  secret: process.env.STYTCH_SECRET || '',
});

export default async function stytchEditMeta(
  meta: Partial<SessionData['user']['untrusted_metadata']>
): Promise<responseType> {
  console.error('\n\n\n', ['stytchEditMeta'], '\n', { untrusted_metadata: meta }, '\n\n\n');
  try {
    const session = await sessionGet();
    const data = session.user.id
      ? await stytchClient.users.update({
          user_id: session.user.id || '',
          untrusted_metadata: meta || {},
        })
      : { user: { untrusted_metadata: meta || {} } };
    const user = {
      untrusted_metadata: data.user.untrusted_metadata,
    };
    await sessionEdit({
      user,
    });
    return { message: JSON.stringify(user), status_code: 200 };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message, status_code: 500 };
  }
}
