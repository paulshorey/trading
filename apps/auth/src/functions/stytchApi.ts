export default async function stytchApi(url: string, post: any) {
  console.log('fetch', `https://test.stytch.com/v1${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${process.env.STYTCH_PROJECTID}:${process.env.STYTCH_SECRET}`
      ).toString('base64')}`,
    },
    body: JSON.stringify(post),
  });
  const res = await fetch(`https://test.stytch.com/v1${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${process.env.STYTCH_PROJECTID}:${process.env.STYTCH_SECRET}`
      ).toString('base64')}`,
    },
    body: JSON.stringify(post),
  });
  return res.json();
}
