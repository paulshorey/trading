export function getDayRange(epoch: number) {
  const date = new Date(epoch * 1000)
  date.setUTCHours(0, 0, 0, 0)
  const startOfDay = Math.floor(date.getTime() / 1000)
  date.setUTCHours(23, 59, 59, 999)
  const endOfDay = Math.floor(date.getTime() / 1000)
  return { startOfDay, endOfDay }
}
