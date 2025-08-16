export async function postOrder(orderText: string) {
  const response = await fetch('/api/v1/market?access_key=testkeyx&', {
    method: 'POST',
    body: orderText,
  })
  return response.json()
}
