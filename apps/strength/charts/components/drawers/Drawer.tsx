'use client'

import React from 'react'
import classes from './Drawer.module.scss'
import { DRAWER_WIDTH } from '../../constants'

export interface DrawerProps {
  /** Whether the drawer is currently open */
  isOpen: boolean
  /** Callback to close the drawer */
  onClose: () => void
  /** The iframe src URL to display */
  iframeSrc: string
  /** Optional custom width (defaults to DRAWER_WIDTH) */
  width?: number
}

/**
 * Shared Drawer component for displaying iframe content
 *
 * Used by DrawerCalendar and DrawerNews to show external widgets
 * in a sliding panel overlay.
 */
export function Drawer({
  isOpen,
  onClose,
  iframeSrc,
  width = DRAWER_WIDTH,
}: DrawerProps) {
  const height =
    typeof window !== 'undefined' ? window.screen.availHeight + 2 : 800

  return (
    <div
      className={`${classes.DrawerOverlay} scale2x`}
      onClick={onClose}
      style={{
        width: isOpen ? '100vw' : 0,
      }}
    >
      <div
        className={classes.DrawerContent}
        style={{
          width: isOpen ? width : 0,
        }}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking content
      >
        <button onClick={onClose} className={classes.DrawerX}>
          X
        </button>
        <iframe
          style={{
            marginTop: '10px',
          }}
          width={width}
          height={height}
          src={iframeSrc}
        />
      </div>
    </div>
  )
}
