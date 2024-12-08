'use client'

import * as React from 'react'
import { Button, Fieldset, TextInput } from '@mantine/core'
import phoneOrEmail from '@my/be/functions/string/phoneOrEmail'
// import stytchApi from '@src/functions/stytchApi';
import stytchPasswordResetStart from '@my/be/auth/actions/stytchPasswordResetStart'
import FieldErrorMessage from '../../../ui/components/blocks/FieldErrorMessage'
import makeToast from '../../../toast/functions/makeToast'
import styles from './index.module.scss'

export default function SignupResetPassword({ csrfToken }: any = {}) {
  const [errorMessage, setErrorMessage] = React.useState('')
  const formResetPasswordRef = React.useRef<HTMLFormElement>(null)
  return (
    <Fieldset legend={<b>Reset password</b>} className={styles.fieldset}>
      {/*
       * Password reset form:
       */}
      <form
        className={styles.form}
        ref={formResetPasswordRef}
        onSubmit={async (e) => {
          e.preventDefault()
          if (formResetPasswordRef.current) {
            const formData = new FormData(formResetPasswordRef.current)
            const data = Object.fromEntries(
              Array.from(formData.entries()).map(([key, value]) => [
                key,
                String(value),
              ])
            )
            const [, email] = phoneOrEmail(data.email || '')
            if (!email) {
              setErrorMessage('Please enter a valid email address.')
              return
            }
            const response = await stytchPasswordResetStart({ email })
            console.log(
              'PasswordResetStart stytchPasswordResetStart response',
              response
            )
            if (response.status_code === 200) {
              console.log(
                'PasswordResetStart stytchPasswordResetStart success!'
              )
              makeToast({
                title:
                  'Success! Now click the link in your email to set a new password.',
                type: 'success',
                duration: 10000,
              })
            } else {
              const err = response.message || 'Error'
              setErrorMessage(err)
              makeToast({ title: err, type: 'error' })
            }
          }
        }}
      >
        <FieldErrorMessage errorMessage={errorMessage} />
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
        <input type="hidden" name="resetPassword" value="true" />
        <div className={`${styles.fieldsetStep} mt-5`}>
          <TextInput
            name="email"
            size="lg"
            placeholder="Your email"
            variant="filled"
            onChange={() => {
              setErrorMessage('')
            }}
          />
        </div>
        <div className={styles.fieldsetStep}>
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className={styles.fieldsetSubmitButton}
            style={{ marginTop: '1rem' }}
          >
            Send link
          </Button>
        </div>
        <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
          You will get an email message with a link to a different page on this
          site. There, you will be able to set a new password.
        </p>
      </form>
    </Fieldset>
  )
}
