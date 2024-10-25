'use client'

type Props = {
  epoch: number
}

export default function LocalShortTime({ epoch }: Props) {
  epoch = Number(epoch)
  const now = new Date()
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime()
  const localTime = new Date(epoch)
    .toLocaleTimeString(undefined, { hourCycle: 'h24' })
    .split(':')
    .slice(0, 2)
    .join(':')
  let localDate = new Date(epoch).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  })
  if (now.getFullYear() === new Date(epoch).getFullYear()) {
    localDate = localDate.substring(0, localDate.length - 6)
  }
  const localTimeDate =
    epoch > midnight ? localTime : `${localTime} ${localDate}`
  return <span>{localTimeDate}</span>
}
