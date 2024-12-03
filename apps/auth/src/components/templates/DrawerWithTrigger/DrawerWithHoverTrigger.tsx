'use client';

import React from 'react';
import classes from './index.module.scss';

type Props = {
  open: boolean;
  setOpen: (value: boolean) => void;
  children: any;
  trigger: any;
  right?: boolean;
};

export default function DrawerWithHoverTrigger({ open, setOpen, children, trigger, right }: Props) {
  return (
    <div
      className={classes.container}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      data-align={right ? 'right' : 'left'}
    >
      {trigger}
      <div
        className={classes.content}
        data-open={open}
        role="presentation"
        data-align={right ? 'right' : 'left'}
      >
        {children}
      </div>
    </div>
  );
}
