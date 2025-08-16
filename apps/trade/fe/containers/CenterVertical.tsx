import React, { HTMLAttributes } from 'react'
import classes from './CenterVertical.module.scss'

export type Props = {} & HTMLAttributes<HTMLDivElement>

export const CenterVertical = ({ children, className, ...rest }: Props) => {
  return (
    <div
      className={classes.container + (className ? ' ' + className : '')}
      {...rest}
    >
      <div>{children}</div>
    </div>
  )
}
