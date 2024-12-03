'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import makeToast from '@src/functions/makeToast';

export default function useAuthReaction() {
  const [errorMessage, setErrorMessage] = React.useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect');

  const success = (message?: string) => {
    setErrorMessage('');
    makeToast({ title: message || 'Success! Welcome!', type: 'success' });
    router.push(redirectUrl || '/');
  };

  const error = (message?: string) => {
    setErrorMessage(message || '');
    if (message) {
      makeToast({ title: message, type: 'error' });
    }
  };

  return { success, error, errorMessage };
}
