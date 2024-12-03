'use server';

import { Client } from 'stytch';
import { sessionGet, sessionEdit } from '@src/app/auth/actions/session';

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || '',
  secret: process.env.STYTCH_SECRET || '',
});

export default async function stytchUpdateMeta(): Promise<any> {
  console.log('OnLoad, stytchUpdateMeta()');
  const session = await sessionGet();
  const user_id = session.user.id;
  console.error('\n\n\n', ['stytchUpdateMeta'], '\n', { user_id }, '\n\n\n');
  if (!user_id) {
    return { message: 'No user_id provided', status_code: 400 };
  }
  try {
    const data = await stytchClient.users.update({
      user_id,
    });
    const user = {
      trusted_metadata: data.user.trusted_metadata,
      untrusted_metadata: data.user.untrusted_metadata,
      name: [
        data.user.name?.first_name || '',
        data.user.name?.middle_name || '',
        data.user.name?.last_name || '',
      ].join(' '),
    };
    await sessionEdit({
      user,
    });
    return { message: 'ok', status_code: 200 };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message, status_code: 500 };
  }
}
