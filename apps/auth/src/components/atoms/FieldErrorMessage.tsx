import * as React from 'react';

export default function FieldErrorMessage({ errorMessage }: { errorMessage?: string } = {}) {
  if (!errorMessage) {
    return null;
  }
  return (
    <p className="text-red-500 text-sm pt-2">
      <b>x</b> &nbsp;{errorMessage}
    </p>
  );
}
