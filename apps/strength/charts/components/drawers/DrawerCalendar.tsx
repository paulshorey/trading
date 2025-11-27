'use client'

import React from 'react'
import { Drawer } from './Drawer'
import { DRAWER_WIDTH } from '../../constants'

interface DrawerCalendarProps {
  drawerOpened: boolean
  closeDrawer: () => void
}

/**
 * Economic calendar drawer
 *
 * Displays an embedded Financial Juice economic calendar widget
 */
export function DrawerCalendar({
  drawerOpened,
  closeDrawer,
}: DrawerCalendarProps) {
  const backColor = '1e222d'
  const fontColor = 'cccccc'
  const height =
    typeof window !== 'undefined' ? window.screen.availHeight + 2 : 800

  const iframeSrc = `https://feed.financialjuice.com/widgets/ecocal.aspx?wtype=ECOCAL&mode=standard&container=financialjuice-eco-widget-container&width=${DRAWER_WIDTH}px&height=${height}px&backC=${backColor}&fontC=${fontColor}&affurl=`

  return (
    <Drawer
      isOpen={drawerOpened}
      onClose={closeDrawer}
      iframeSrc={iframeSrc}
      width={DRAWER_WIDTH}
    />
  )
}
