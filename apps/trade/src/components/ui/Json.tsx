'use client';

import { JsonView, darkStyles } from 'react-json-view-lite';
import classes from './Json.module.scss';
import Copy from './Copy';

export default function Json({ data }: any) {
  const styles = darkStyles;
  for (const key in styles) {
    if (classes[key]) {
      // @ts-ignore
      styles[key] = `${styles[key]} ${classes[key]}`;
    }
  }
  styles.noQuotesForStringValues = true;
  return (
    <div className={`relative px-1 pb-1 bg-slate-800 ${classes.JsonViewContainer}`}>
      <Copy
        text={JSON.stringify(data, null, 2)}
        className="right-1 top-1"
        style={{ position: 'absolute' }}
      />
      <JsonView
        data={data}
        shouldExpandNode={(level: number) => level === 0 || level === 1 || level === 2}
        clickToExpandNode
        style={styles}
      />
    </div>
  );
}
