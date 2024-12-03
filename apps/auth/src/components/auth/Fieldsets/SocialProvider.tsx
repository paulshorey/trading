'use client'

import * as React from 'react'
import {
  Button,
  Fieldset,
  Checkbox,
  Collapse,
} from '@my/fe/src/components/mantine'
import { useDisclosure } from '@my/fe/src/hooks/mantine'
import styles from './index.module.scss'
// import stytchPasswordAuthenticate from '@src/app/auth/actions/stytchPasswordAuthenticate';
import makeToast from '@src/functions/makeToast'
// import phoneOrEmail from '@src/functions/string/phoneOrEmail';

export default function SocialProvider({ csrfToken }: any = {}) {
  const [infoOpened, { toggle: toggleInfoOpened }] = useDisclosure(false)
  const [email, setEmail] = React.useState('')
  const [errorMessage, setErrorMessage] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)
  return (
    <Fieldset
      legend="Verify your identity via social service:"
      className={styles.fieldset}
    >
      {/* Regular username/password form:  */}
      <form
        className={styles.form}
        ref={formRef}
        onSubmit={async (e) => {
          e.preventDefault()
          // if (formRef.current) {
          //   const formData = new FormData(formRef.current);
          //   const data = Object.fromEntries(
          //     Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
          //   );
          //   const [, validEmail] = phoneOrEmail(data.email);
          //   if (!validEmail) {
          //     setErrorMessage('Please enter a valid email address.');
          //     return;
          //   }
          //   const response = await stytchPasswordAuthenticate({
          //     email: data.email,
          //     password: data.password,
          //   });
          //   if (response.status_code === 200) {
          //     // Success
          //     console.log('password auth success');
          //     setErrorMessage('');
          //   } else {
          //     const err = response.message || 'Error';
          //     setErrorMessage(err);
          //     makeToast({ title: err, type: 'error' });
          //   }
          // }
          makeToast({
            title: 'Not finished yet. Please check back.',
            type: 'error',
          })
        }}
      >
        {!!errorMessage && (
          <p className="text-red-500 text-sm pt-2">
            <b>x</b> &nbsp;{errorMessage}
          </p>
        )}
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
        <div className={`${styles.fieldsetStep} mt-6 mb-4`}>...</div>
        <div
          className={styles.fieldsetStep}
          data-state={!email ? 'disabled' : 'active'}
        >
          <Checkbox
            label={
              <span className="text-sm">Remember me until I sign out</span>
            }
            className="pt-4"
          />
        </div>
        <div className={styles.fieldsetStep}>
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className={styles.fieldsetSubmitButton}
          >
            Enter site
          </Button>
        </div>
        <Collapse
          in={!infoOpened}
          onClick={toggleInfoOpened}
          onKeyDown={toggleInfoOpened}
          role="presentation"
        >
          <p className="text-stone-500 text-sm pt-4 pb-3">
            <b>i</b> &nbsp;Learn how this connects to your account
          </p>
        </Collapse>
        <Collapse
          in={infoOpened}
          onClick={toggleInfoOpened}
          onKeyDown={toggleInfoOpened}
          role="presentation"
        >
          <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
            This only shares your name, email, avatar, and proves you are human.
          </p>
          <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
            If you already have an account with same email as this social
            provider, this will sign in to your existing account.
          </p>
          <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
            If you already have an account with PHONE (no email), then this will
            create a new account. INSTEAD, PLEASE login with phone and go to
            your account profile to add a Social Provider.
          </p>
          <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
            We will never be able to view your social media content or post on
            your profile.
          </p>
        </Collapse>
      </form>
    </Fieldset>
  )
}
