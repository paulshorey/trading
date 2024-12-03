'use client';

import SearchInNewTab from '@src/components/home/SearchInNewTab';
import classes from './index.module.scss';

export default function Home({}: any) {
  return (
    <div className={classes.container}>
      <SearchInNewTab />
    </div>
  );
}
