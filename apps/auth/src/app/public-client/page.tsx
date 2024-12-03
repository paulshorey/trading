'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { CodeHighlight } from '@my/fe/src/components/inline/CodeHighlight'
import PageContentHeader from '@src/components/templates/PageContentHeader'
import PageContent from '@src/components/templates/PageContent'

const DateAndTime = dynamic(
  () => import('@src/components/account/DateAndTime'),
  {
    ssr: false,
    loading: () => <p>Loading...</p>,
  }
)

const exampleCode = `
// VisuallyHidden component source code

import {
  Box,
  BoxProps,
  StylesApiProps,
  factory,
  ElementProps,
  useProps,
  useStyles,
  Factory,
} from '../../core';
import classes from './VisuallyHidden.module.css';

export type VisuallyHiddenStylesNames = 'root';

export interface VisuallyHiddenProps
  extends BoxProps,
    StylesApiProps<VisuallyHiddenFactory>,
    ElementProps<'div'> {}

export type VisuallyHiddenFactory = Factory<{
  props: VisuallyHiddenProps;
  ref: HTMLDivElement;
  stylesNames: VisuallyHiddenStylesNames;
}>;

const defaultProps: Partial<VisuallyHiddenProps> = {};

export const VisuallyHidden = factory<VisuallyHiddenFactory>((_props, ref) => {
  const props = useProps('VisuallyHidden', defaultProps, _props);
  const { classNames, className, style, styles, unstyled, vars, ...others } = props;

  const getStyles = useStyles<VisuallyHiddenFactory>({
    name: 'VisuallyHidden',
    classes,
    props,
    className,
    style,
    classNames,
    styles,
    unstyled,
  });
  return <Box component="span" ref={ref} {...getStyles('root')} {...others} />;
});
`

export default function PublicPageClient() {
  return (
    <div>
      <PageContentHeader title='This page built with NextJS "use client"' />
      <PageContent>
        {/* @ts-ignore */}
        <DateAndTime />

        <hr />

        <CodeHighlight code={exampleCode} language="tsx" />
      </PageContent>
    </div>
  )
}
