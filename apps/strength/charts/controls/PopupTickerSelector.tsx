/**
 * This is experimental. It is not used.
 */
import { useDisclosure } from '@mantine/hooks'
import { Modal, ScrollArea, TextInput } from '@mantine/core'
import { useEffect } from 'react'

export function PopupTickerSelector({ triggerOpen }: { triggerOpen: boolean }) {
  const [opened, { open, close }] = useDisclosure(false)

  useEffect(() => {
    if (triggerOpen) {
      open()
    }
  }, [triggerOpen])

  const content = Array(100)
    .fill(0)
    .map((_, index) => <p key={index}>Modal with scroll</p>)

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={<h1>Header is sticky</h1>}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {content}

      <TextInput
        data-autofocus
        label="Input with initial focus"
        placeholder="It has data-autofocus attribute"
        mt="md"
      />
    </Modal>
  )
}
