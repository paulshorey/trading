/**
 * Chart Scaling Fix for 2x Rendering
 *
 * This module provides a workaround for the 2x scaling rendering technique
 * used in the charts. The page uses CSS `zoom: 0.5` while charts render at
 * 2x dimensions for sharper display on high-DPI screens.
 *
 * The Problem:
 * When the page is scaled down via CSS zoom, the Lightweight Charts library
 * doesn't account for this when handling mouse events. Mouse coordinates
 * are relative to the browser viewport, but the chart thinks it's 2x wider
 * than it appears.
 *
 * The Solution:
 * Intercept mouse events on the chart container, correct the coordinates
 * by the scale factor, and dispatch new events with corrected positions.
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   if (containerRef.current) {
 *     return attachScalingFix(containerRef.current, 2)
 *   }
 * }, [])
 * ```
 */

import { SCALE_FACTOR } from '../constants'

/**
 * Mouse events that need coordinate correction
 */
const MOUSE_EVENTS = [
  'mousemove',
  'mouseenter',
  'mouseleave',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
] as const

/**
 * Creates a mouse event handler that corrects coordinates for scaling
 *
 * @param container - The chart container element
 * @param scale - The scale factor (default: SCALE_FACTOR)
 * @returns Event handler function
 */
function createScalingEventHandler(
  container: HTMLElement,
  scale: number = SCALE_FACTOR
): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    // Skip if we already processed this event (prevent infinite loop)
    if ((e as any)._patched) return

    e.stopPropagation()

    const rect = container.getBoundingClientRect()

    // Calculate corrected coordinates relative to the container
    // Since the container appears smaller due to zoom, we need to scale up
    // the relative position within it
    const relativeX = e.clientX - rect.left
    const relativeY = e.clientY - rect.top

    const newClientX = rect.left + relativeX * scale
    const newClientY = rect.top + relativeY * scale

    // Create a new event with corrected coordinates
    const newEvent = new MouseEvent(e.type, {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: e.detail,
      screenX: e.screenX,
      screenY: e.screenY,
      clientX: newClientX,
      clientY: newClientY,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      button: e.button,
      buttons: e.buttons,
      relatedTarget: e.relatedTarget,
    })

    // Mark as patched to prevent re-processing
    Object.defineProperty(newEvent, '_patched', { value: true })

    // Dispatch the corrected event
    e.target?.dispatchEvent(newEvent)
  }
}

/**
 * Attach scaling fix to a chart container
 *
 * Intercepts all mouse events and dispatches corrected versions
 * that account for the 2x scaling/0.5x zoom rendering technique.
 *
 * @param container - The chart container element
 * @param scale - The scale factor (default: SCALE_FACTOR from constants)
 * @returns Cleanup function to remove event listeners
 *
 * @example
 * ```tsx
 * // In Chart component
 * useEffect(() => {
 *   if (containerRef.current) {
 *     return attachChartScalingFix(containerRef.current)
 *   }
 * }, [])
 * ```
 */
export function attachChartScalingFix(
  container: HTMLElement,
  scale: number = SCALE_FACTOR
): () => void {
  const handler = createScalingEventHandler(container, scale)

  // Attach listeners in capture phase to intercept before chart processes them
  MOUSE_EVENTS.forEach((eventName) => {
    container.addEventListener(eventName, handler as EventListener, {
      capture: true,
    })
  })

  // Return cleanup function
  return () => {
    MOUSE_EVENTS.forEach((eventName) => {
      container.removeEventListener(eventName, handler as EventListener, {
        capture: true,
      })
    })
  }
}
