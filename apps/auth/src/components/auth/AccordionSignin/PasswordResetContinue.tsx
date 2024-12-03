'use client'

import * as React from 'react'
import { Accordion, AccordionValue } from '@my/fe/src/components/mantine'
import Link from 'next/link'
import styles from './index.module.scss'
import PasswordSet from '../Fieldsets/PasswordResetContinue'
// import SignupOtpCode from '@src/components/auth/Fieldsets/OtpCode';
// import makeToast from '@src/functions/makeToast';

export default function AccordionSignin({ error, csrfToken }: any = {}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  // React.useEffect(() => {
  //   sessionStart({ ui: { signupPageTimestamp: Date.now() } });
  // }, []);
  return (
    <div className={styles.container} ref={containerRef}>
      <h1 className={styles.title}>
        <span
          className="text-green-500"
          style={{
            textShadow: '3px 5px 4px rgba(0,0,0,0.11)',
            filter: 'brightness(0.9)',
          }}
        >
          Reset password
        </span>{' '}
        <br />
        and you will be signed in
      </h1>

      {!!error && (
        <div className={styles.error}>
          <span className="text-red-500">
            <b>x</b> &nbsp;{error}
          </span>
        </div>
      )}

      <Accordion
        className={styles.accordion}
        defaultValue="activeAccordionPasswordSet"
        onChange={(value: AccordionValue<any>) => {
          const id = typeof value === 'string' ? value : value?.[0] || ''
          // makeToast({
          //   id: 'signupAccordionItem',
          //   title: `Switched to ${id}`,
          //   description: 'Next time you load this page, it will auto-open.',
          //   // x: true,
          // });
          const el = document.getElementById(id)
          const firstInput = el?.querySelector('input')
          if (firstInput) {
            setTimeout(() => {
              if (firstInput) {
                firstInput.click()
                firstInput.focus()
              }
            }, 500)
          }
        }}
      >
        <Accordion.Item
          value="activeAccordionPasswordSet"
          id="activeAccordionPasswordSet"
          className={styles.accordionItem}
        >
          <Accordion.Control>Set a new password</Accordion.Control>
          <Accordion.Panel>
            <PasswordSet />
          </Accordion.Panel>
        </Accordion.Item>
        <Link href="/auth/signin">
          <Accordion.Item
            value="activeAccordionOtp"
            id="activeAccordionOtp"
            className={styles.accordionItem}
          >
            <Accordion.Control>
              Go back to regular login/signup
            </Accordion.Control>
            <Accordion.Panel>
              <br /> <br />
              ...
            </Accordion.Panel>
          </Accordion.Item>
        </Link>
      </Accordion>
    </div>
  )
}
