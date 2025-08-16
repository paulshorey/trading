'use server';

import { headers } from 'next/headers';

export const getCurrentIpAddress = async function () {
  'use server';

  const headersList = await headers();
  const client_ip = headersList.get('x-forwarded-for') || headersList.get('remote-addr') || '';
  let server_ip = '';
  let server_location = '';
  try {
    const response = await fetch('http://ip-api.com/json');
    const address = await response.json();
    server_ip = address.query;
    server_location = `${address.city}, ${address.regionName}, ${address.country}`;
  } catch (error) {
    //
  }

  return {
    client_ip,
    server_ip,
    server_location,
  };
};
