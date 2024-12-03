import {
  useMantineColorScheme,
  Button,
  Group,
} from '@my/fe/src/components/mantine'
import stytchEditMeta from '@src/app/auth/actions/stytchEditMeta'

export function ColorSchemeSwitcher() {
  const { setColorScheme } = useMantineColorScheme()

  return (
    <Group>
      <Button
        onClick={() => {
          setColorScheme('light')
          stytchEditMeta({ color_scheme: 'light' })
        }}
      >
        Light
      </Button>
      <Button
        onClick={() => {
          setColorScheme('dark')
          stytchEditMeta({ color_scheme: 'dark' })
        }}
      >
        Dark
      </Button>
    </Group>
  )
}
