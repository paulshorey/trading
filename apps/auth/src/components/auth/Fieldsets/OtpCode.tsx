'use client'

import * as React from 'react'
import {
  Button,
  Checkbox,
  Fieldset,
  TextInput,
} from '@my/fe/src/components/mantine'
// import { useRouter } from 'next/navigation';
import stytchOtpSend from '@src/app/auth/actions/stytchOtpSend'
import stytchOtpAuthenticate from '@src/app/auth/actions/stytchOtpAuthenticate'
// import { sessionEdit } from '@src/app/auth/actions/session';
import makeToast from '@src/functions/makeToast'
import useAuthReaction from '@src/hooks/useAuthReaction'
import styles from './index.module.scss'

export default function SignupOtpCode({ csrfToken }: any = {}) {
  const { success, error, errorMessage } = useAuthReaction()
  const [phoneOrEmail, setPhoneOrEmail] = React.useState('')
  const [codeSent, setCodeSent] = React.useState(false)
  const [otpMethodId, setOtpMethodId] = React.useState('')
  const [otpCode, setOtpCode] = React.useState('')
  // const router = useRouter();
  const handleInputChange = (value: string) => {
    setPhoneOrEmail(value)
    setCodeSent(false)
  }
  return (
    <Fieldset
      legend="No passwords or registration needed!"
      className={styles.fieldset}
    >
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault()
          /*
           * Step 1: Authenticate
           */
          if (phoneOrEmail) {
            const response = await stytchOtpSend({ phoneOrEmail })
            if (response.email_id || response.phone_id) {
              setCodeSent(true)
              setOtpMethodId(response.email_id || response.phone_id)
              error('')
              return
            }
            const err = response.message || 'Error'
            error(err)
            makeToast({ title: err, type: 'error' })
            return
          }
          /*
           * 0: No user input
           */
          error('Please enter your phone or email.')
        }}
      >
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />

        {/* Part 1: Receive code */}
        <div
          className={`${styles.fieldsetStep} mt-3 mb-3`}
          data-state={codeSent ? 'disabled' : 'active'}
        >
          <TextInput
            name="phoneOrEmail"
            size="lg"
            label="1. Receive code"
            placeholder="Your phone or email"
            variant="filled"
            value={phoneOrEmail}
            onChange={(e) => handleInputChange(e.currentTarget.value)}
            autoFocus={!codeSent}
            rightSection={
              <Button
                className={styles.buttonLink}
                style={{ scale: '1.33' }}
                type="submit"
              >
                <b>send</b>
              </Button>
            }
          />
          {!!errorMessage && (
            <p className="text-red-500 text-sm pt-2">
              <b>x</b> &nbsp;{errorMessage}
            </p>
          )}
          {!!codeSent && (
            <p className="text-green-500 text-sm pt-2">
              Code sent! Now just paste it below.&thinsp;↓
            </p>
          )}
        </div>
      </form>

      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault()
          /*
           * Step 2: Authenticate
           */
          if (phoneOrEmail && otpCode.length >= 6) {
            const response = await stytchOtpAuthenticate({
              code: otpCode,
              method_id: otpMethodId,
            })
            // Success
            if (response.session?.user.auth) {
              success()
              return
            }
            // Failure
            if (response.message?.includes('method_id')) {
              error('')
              setOtpCode('')
              setOtpMethodId('')
            } else {
              error(response.message || 'Error')
              return
            }
          }
          /*
           * Step 1: Authenticate
           */
          if (phoneOrEmail) {
            const response = await stytchOtpSend({ phoneOrEmail })
            if (response.email_id || response.phone_id) {
              setCodeSent(true)
              setOtpMethodId(response.email_id || response.phone_id)
              error('')
              return
            }
            const err = response.message || 'Error'
            error(err)
            makeToast({ title: err, type: 'error' })
            return
          }
          /*
           * 0: No user input
           */
          error('Please enter your phone or email.')
        }}
      >
        {/* Part 2: Confirm code */}
        <div
          className={`${styles.fieldsetStep} mt-2 mb-2`}
          data-state={!codeSent ? 'disabled' : 'active'}
        >
          <TextInput
            className="shdow-sm"
            name="confirmCode"
            size="lg"
            label="2. Confirm code"
            placeholder="_ _ _ _ _ _"
            variant="filled"
            value={otpCode}
            onChange={(e) => setOtpCode(e.currentTarget.value)}
          />
          <Checkbox
            label={
              <span className="text-sm">Remember me until I sign out</span>
            }
            className="pt-4"
          />
        </div>

        <div className={`${styles.fieldsetStep} mb-1`}>
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className={styles.fieldsetSubmitButton}
          >
            {/* {!codeSent ? 'Submit' : 'Enter site'} */}
            Enter site
          </Button>
        </div>

        {/* <p className="text-stone-500 text-sm pt-3 pb-3">
          You'll be able to add a password if you want.
        </p> */}
      </form>
    </Fieldset>
  )
}
