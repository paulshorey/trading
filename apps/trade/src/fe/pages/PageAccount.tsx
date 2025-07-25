'use client'

import { Data } from '@src/fe/blocks/Data'
import classes from './PageAccount.module.scss'
import { FormEvent, useEffect, useState } from 'react'
import { getAccountData } from '@src/fe/utils/getAccountData'
import { postOrder } from '@src/fe/utils/postOrder'

export const revalidate = 0

export function PageAccount() {
  const [orderText, setOrderText] = useState('')
  const [accountData, setAccountData] = useState<Record<string, unknown>>({})

  const fetchAccountData = () => {
    getAccountData().then((data) => {
      setAccountData(data)
    })
  }

  useEffect(() => {
    fetchAccountData()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    postOrder(orderText)
    setOrderText('')
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
        />
        <button className="p-2" type="submit">
          Submit
        </button>
        <button className="p-2" type="button" onClick={fetchAccountData}>
          Refresh
        </button>
      </form>

      <Data data={accountData} expandUntil={5} allExpanded={true} />
    </div>
  )
}
