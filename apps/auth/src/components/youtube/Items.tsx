import React from 'react';
import { videoType } from '@src/app/youtube/page';
import classes from './index.module.scss';
import Screenshots from './Screenshots';

type Props = any;

export default function Items({ thumbScale = 2, items, debug, options = {} }: Props) {
  if (!items) return <p>Loading...</p>;
  if (debug) {
    return (
      <pre>
        <code>{JSON.stringify(items, null, 2)}</code>
      </pre>
    );
  }
  return (
    <div className="flex flex-col">
      {items.map((item: any) => (
        <div key={item.id} className={classes.video}>
          <a
            className={classes.videoImages}
            href={`https://youtube.com/watch?v=${item.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Screenshots item={item} thumbScale={thumbScale} options={options} />
          </a>
          <h3 className={classes.videoTitle}>{item.title}</h3>
          <p className={classes.videoText}>{item.description}</p>
        </div>
      ))}
    </div>
  );
}
