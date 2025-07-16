'use client'

import { Data } from '@src/fe/blocks/Data'
import classes from './PageAccount.module.scss'
import { FormEvent, useEffect, useState, useRef } from 'react'
import { getAccountData } from '@src/fe/utils/getAccountData'
import { postOrder } from '@src/fe/utils/postOrder'

export const revalidate = 0

export function PageAccount() {
  const [orderText, setOrderText] = useState('')
  const [accountData, setAccountData] = useState<Record<string, unknown>>({})
  const [isPolling, setIsPolling] = useState(false)
  const [secondsPassed, setSecondsPassed] = useState(0)

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const pollCountRef = useRef(0)
  const initialDataRef = useRef<Record<string, unknown> | null>(null)

  const fetchAccountData = () => {
    getAccountData().then((data) => {
      setAccountData(data)
    })
  }

  useEffect(() => {
    fetchAccountData()

    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [])

  const stopPolling = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    pollingIntervalRef.current = null
    timerIntervalRef.current = null
    pollCountRef.current = 0
    setIsPolling(false)
    setSecondsPassed(0)
    setOrderText('')
  }

  const pollForData = () => {
    pollCountRef.current += 1

    getAccountData().then((newData) => {
      if (initialDataRef.current && JSON.stringify(newData) !== JSON.stringify(initialDataRef.current)) {
        setAccountData(newData)
        stopPolling()
      } else if (pollCountRef.current >= 10) {
        stopPolling()
      }
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setIsPolling(true)
    postOrder(orderText)

    initialDataRef.current = accountData

    timerIntervalRef.current = setInterval(() => {
      setSecondsPassed((prev) => prev + 1)
    }, 1000)

    pollForData() // Initial call
    pollingIntervalRef.current = setInterval(pollForData, 15000)
  }

  return (
    <div className={classes.container}>
      <form onSubmit={handleSubmit}>
        <input
          className="p-2"
          type="text"
          value={orderText}
          onChange={(e) => {
            setOrderText(e.target.value)
          }}
          disabled={isPolling}
        />
        <button className="p-2" type="submit" disabled={isPolling}>
          {isPolling ? '...' : '✔️'}
        </button>
        {isPolling && <span className="p-2">{secondsPassed}</span>}
      </form>

      <Data data={accountData} expandUntil={5} />
    </div>
  )
}
