'use client'

import React from 'react'
import { Drawer } from './Drawer'
import { DRAWER_WIDTH } from '../../constants'

interface DrawerNewsProps {
  drawerOpened: boolean
  closeDrawer: () => void
}

/**
 * News feed drawer
 *
 * Displays an embedded Financial Juice news headlines widget
 */
export function DrawerNews({ drawerOpened, closeDrawer }: DrawerNewsProps) {
  const backColor = '1e222d'
  const fontColor = 'cccccc'
  const height =
    typeof window !== 'undefined' ? window.screen.availHeight + 2 : 800

  const iframeSrc = `https://feed.financialjuice.com/widgets/headlines.aspx?wtype=NEWS&mode=Dark&container=financialjuice-news-widget-container&width=${DRAWER_WIDTH}px&height=${height}px&backC=${backColor}&fontC=${fontColor}&affurl=`

  return (
    <Drawer
      isOpen={drawerOpened}
      onClose={closeDrawer}
      iframeSrc={iframeSrc}
      width={DRAWER_WIDTH}
    />
  )
}
