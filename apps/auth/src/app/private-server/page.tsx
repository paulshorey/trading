'use server'

import * as React from 'react'
import UserCard from '@src/components/account/UserCard'
import useSessionOrLoginServer from '@my/fe/src/auth/hooks/useSessionOrLoginServer'
import PageContentHeader from '@src/components/templates/PageContentHeader'
import PageContent from '@src/components/templates/PageContent'
import DateAndTime from '@src/components/account/DateAndTime'

export default async function PrivatePage() {
  const session = await useSessionOrLoginServer('/private-server')
  return (
    <div>
      <PageContentHeader title='This page built with NextJS "use server"' />
      <PageContent>
        <DateAndTime />
        <UserCard user={session?.user} />
      </PageContent>
    </div>
  )
}
