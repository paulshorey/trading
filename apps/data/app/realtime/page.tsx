'use client'

import { Container, Stack, Title, Text, Alert, Code } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { RealtimeStrengthMonitor } from '../../components/RealtimeStrengthMonitor'
import { WebSocketProvider } from '@apps/common/fe/components/providers/WebSocketProvider'

export default function RealtimePage() {
  return (
    <WebSocketProvider>
      <Container size="lg" py="xl">
        <Stack gap="lg">
          <div>
            <Title order={1}>Real-time Data Monitor</Title>
            <Text size="lg" c="dimmed" mt="xs">
              Live WebSocket updates for strength data
            </Text>
          </div>

          <Alert
            icon={<IconInfoCircle size="1rem" />}
            title="WebSocket Connection"
            color="blue"
            variant="light"
          >
            <Stack gap="xs">
              <Text size="sm">
                This page demonstrates real-time WebSocket updates. When new
                strength data is added to the database, it will automatically
                appear here without needing to refresh the page.
              </Text>
              <Text size="sm">
                To test, send a POST request to <Code>/api/v1/market</Code> with
                strength data.
              </Text>
            </Stack>
          </Alert>

          <RealtimeStrengthMonitor />
        </Stack>
      </Container>
    </WebSocketProvider>
  )
}
