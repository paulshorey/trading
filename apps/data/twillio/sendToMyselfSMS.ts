const myHeaders = new Headers()
const authHeader = `Basic ${Buffer.from(
  process.env.TWILLIO_USERNAME_PASSWORD || ''
).toString('base64')}`
myHeaders.append('Authorization', authHeader)

export const sendToMyselfSMS = (message: string) => {
  const formdata = new FormData()
  formdata.append('To', '13857706789')
  formdata.append('From', '19133649396')
  formdata.append('Body', message)

  return new Promise((resolve) => {
    if (!process.env.TWILLIO_USERNAME_PASSWORD) {
      resolve(true)
    }
    fetch(
      'https://api.twilio.com/2010-04-01/Accounts/AC258697f0ec08c434f11a2f19de0ce74b/Messages.json',
      {
        method: 'POST',
        headers: myHeaders,
        body: formdata,
      }
    )
      .then(() => {
        resolve(true)
      })
      .catch((error) => {
        console.error('Twillio POST failed!', error)
        resolve(false)
      })
      .finally(() => {
        resolve(false)
      })
  })
}
