'use client';

import { useEffect } from 'react';
import stytchUpdateMeta from '@src/app/auth/actions/stytchUpdateMeta';

export default function OnLoad({ children }: any) {
  useEffect(() => {
    stytchUpdateMeta();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        stytchUpdateMeta();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return children;
}
