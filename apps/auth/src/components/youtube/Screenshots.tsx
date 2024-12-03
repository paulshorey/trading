'use client';

import Image from 'next/image';
import React from 'react';

export default function Screenshots({ item, thumbScale }: any) {
  const [hasScreenshot, setHasScreenshot] = React.useState(true);
  // return null;
  return (
    <>
      {hasScreenshot ? (
        <>
          <Image
            className="rounded-md mr-[-1rem]"
            src={`https://img.youtube.com/vi/${item.id}/maxres1.jpg`}
            alt={item.title}
            width={item.tw / thumbScale}
            height={item.th / thumbScale}
            onError={() => {
              setHasScreenshot(false);
            }}
          />
          <Image
            className="rounded-md mr-[-1rem]"
            src={`https://img.youtube.com/vi/${item.id}/maxres2.jpg`}
            alt={item.title}
            width={item.tw / thumbScale}
            height={item.th / thumbScale}
          />
          <Image
            className="rounded-md"
            src={`https://img.youtube.com/vi/${item.id}/maxres3.jpg`}
            alt={item.title}
            width={item.tw / thumbScale}
            height={item.th / thumbScale}
          />
        </>
      ) : (
        <Image
          className="rounded-md mr-[-1rem]"
          src={`https://img.youtube.com/vi/${item.id}/maxresdefault.jpg`}
          alt={item.title}
          width={item.tw / thumbScale}
          height={item.th / thumbScale}
          loading="lazy"
        />
      )}
    </>
  );
}
