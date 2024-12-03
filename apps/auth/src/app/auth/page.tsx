'use client';

import { useEffect } from 'react';
import * as React from 'react';
import SigninSignupReset from '@src/components/auth/AccordionSignin';
import stytchRevokeSession from '@src/app/auth/actions/stytchRevokeSession';
import { SessionContext } from '@src/context/SessionProvider';

export default function AuthSigninPage() {
  const session = React.useContext(SessionContext);
  useEffect(() => {
    // When user first loads the page, revoke any existing session.
    if (session?.user?.auth) {
      (async () => {
        const response = await stytchRevokeSession();
        console.log('auth page stytchRevokeSession response', response);
      })();
    }
  }, []);
  return <SigninSignupReset />;
}
