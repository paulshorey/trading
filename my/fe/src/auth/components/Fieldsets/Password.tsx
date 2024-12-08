'use client'

import * as React from 'react'
import { Button, Fieldset, TextInput, Checkbox } from '@mantine/core'
import styles from './index.module.scss'
import stytchPasswordAuthenticate from '@my/be/auth/actions/stytchPasswordAuthenticate'
import phoneOrEmail from '@my/be/functions/string/phoneOrEmail'
import useAuthReaction from '../../hooks/useAuthReaction'

export default function SignupPassword({ csrfToken }: any = {}) {
  const { success, error, errorMessage } = useAuthReaction()
  const [email, setEmail] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)

  return (
    <Fieldset legend={<b>Sign in</b>} className={styles.fieldset}>
      {/* Regular username/password form:  */}
      <form
        className={styles.form}
        ref={formRef}
        onSubmit={async (e) => {
          e.preventDefault()
          if (formRef.current) {
            const formData = new FormData(formRef.current)
            const data = Object.fromEntries(
              Array.from(formData.entries()).map(([key, value]) => [
                key,
                String(value),
              ])
            )
            const [, validEmail] = phoneOrEmail(data.email || '')
            if (!validEmail) {
              error('Please enter a valid email address.')
              return
            }
            const response = await stytchPasswordAuthenticate({
              email: data.email || '',
              password: data.password || '',
            })
            // Successful
            if (response.session?.user.auth) {
              success()
              return
            }
            // Failed
            error(response.message || 'Error')
          }
        }}
      >
        {!!errorMessage && (
          <p className="text-red-500 text-sm pt-2">
            <b>x</b> &nbsp;{errorMessage}
          </p>
        )}
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
        <div className={`${styles.fieldsetStep} mt-6 mb-4`}>
          <TextInput
            name="email"
            size="lg"
            placeholder="Your email"
            variant="filled"
            value={email}
            onChange={(event) => {
              setEmail(event.currentTarget.value)
              error('')
            }}
          />
        </div>
        <div
          className={styles.fieldsetStep}
          data-state={!email ? 'disabled' : 'active'}
        >
          <TextInput
            name="password"
            type="password"
            size="lg"
            placeholder="Your password"
            variant="filled"
          />
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
        <p className="text-stone-500 text-[1rem] pt-5 pb-4 text-center">
          To "sign up" with password, please first "Receive code" above. You'll
          be able to add a password in your profile settings.
        </p>
      </form>
    </Fieldset>
  )
}
