import * as React from 'react'
import { Avatar } from '@my/fe/src/components/mantine'
import classes from './index.module.scss'

export default function AvatarIcon({ size }: { size?: string } = {}) {
  return <Avatar radius={size} data-size={size} className={classes.avatar} />
}
