import React from 'react';

export default (function DateAndTime() {
  return <h1>Date and Time: {new Date().toLocaleString()}</h1>;
} as React.FC);
