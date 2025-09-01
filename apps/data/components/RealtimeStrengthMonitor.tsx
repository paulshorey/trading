'use client'

import React, { useState, useEffect } from 'react'
import { useStrengthUpdates } from '@apps/common/fe/hooks/useWebSocket'
import {
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Select,
  ScrollArea,
  Paper,
  Divider,
} from '@mantine/core'

interface StrengthUpdate {
  id?: string
  ticker: string
  interval: string
  strength: number
  price?: number
  volume?: number
  timenow: Date | string
}

/**
 * Real-time Strength Monitor Component
 * Displays live updates of strength data as they come in via WebSocket
 */
export function RealtimeStrengthMonitor() {
  const [selectedTicker, setSelectedTicker] = useState<string>('')
  const [updates, setUpdates] = useState<StrengthUpdate[]>([])
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting')

  // Subscribe to strength updates
  const latestUpdate = useStrengthUpdates(
    selectedTicker || undefined,
    (data: StrengthUpdate) => {
      // Add new update to the list (keep last 50)
      setUpdates((prev) => [data, ...prev].slice(0, 50))
      setConnectionStatus('connected')
    }
  )

  // Format timestamp
  const formatTime = (timenow: Date | string) => {
    const date = new Date(timenow)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // Format number values
  const formatNumber = (value: number | undefined, decimals: number = 2) => {
    if (value === undefined || value === null) return '-'
    return value.toFixed(decimals)
  }

  // Get strength color based on value
  const getStrengthColor = (strength: number) => {
    if (strength > 70) return 'green'
    if (strength > 30) return 'yellow'
    if (strength > -30) return 'orange'
    return 'red'
  }

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        {/* Header */}
        <Group justify="space-between" align="center">
          <Title order={3}>Real-time Strength Monitor</Title>
          <Badge
            color={
              connectionStatus === 'connected'
                ? 'green'
                : connectionStatus === 'connecting'
                  ? 'yellow'
                  : 'red'
            }
            variant="dot"
          >
            {connectionStatus}
          </Badge>
        </Group>

        {/* Ticker Filter */}
        <Select
          label="Filter by Ticker (leave empty for all)"
          placeholder="Select or type a ticker..."
          data={[
            { value: '', label: 'All Tickers' },
            { value: 'BTCUSD', label: 'BTCUSD' },
            { value: 'ETHUSD', label: 'ETHUSD' },
            { value: 'SOLUSD', label: 'SOLUSD' },
            { value: 'AVAXUSD', label: 'AVAXUSD' },
          ]}
          value={selectedTicker}
          onChange={(value) => setSelectedTicker(value || '')}
          searchable
          clearable
        />

        <Divider />

        {/* Latest Update Display */}
        {latestUpdate && (
          <Paper p="md" withBorder>
            <Text size="sm" c="dimmed" mb="xs">
              Latest Update
            </Text>
            <Group justify="space-between">
              <Text fw={600}>{latestUpdate.ticker}</Text>
              <Badge color={getStrengthColor(latestUpdate.strength)} size="lg">
                {formatNumber(latestUpdate.strength, 1)}
              </Badge>
            </Group>
            <Group gap="xs" mt="xs">
              <Text size="sm" c="dimmed">
                Interval: {latestUpdate.interval}
              </Text>
              {latestUpdate.price && (
                <Text size="sm" c="dimmed">
                  Price: ${formatNumber(latestUpdate.price, 2)}
                </Text>
              )}
              {latestUpdate.volume && (
                <Text size="sm" c="dimmed">
                  Vol: {formatNumber(latestUpdate.volume, 0)}
                </Text>
              )}
            </Group>
          </Paper>
        )}

        {/* Updates List */}
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Recent Updates ({updates.length})
          </Text>
          <ScrollArea h={400} type="auto">
            <Stack gap="xs">
              {updates.length === 0 ? (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  Waiting for updates...
                </Text>
              ) : (
                updates.map((update, index) => (
                  <Paper
                    key={`${update.id}-${index}`}
                    p="sm"
                    withBorder
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: `var(--mantine-color-${getStrengthColor(
                        update.strength
                      )}-6)`,
                    }}
                  >
                    <Group justify="space-between" mb="xs">
                      <Group gap="xs">
                        <Text fw={600} size="sm">
                          {update.ticker}
                        </Text>
                        <Badge size="sm" variant="light">
                          {update.interval}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {formatTime(update.timenow)}
                      </Text>
                    </Group>

                    <Group gap="lg">
                      <Stack gap={0}>
                        <Text size="xs" c="dimmed">
                          Strength
                        </Text>
                        <Text
                          size="sm"
                          fw={500}
                          c={getStrengthColor(update.strength)}
                        >
                          {formatNumber(update.strength, 1)}
                        </Text>
                      </Stack>

                      {update.price && (
                        <Stack gap={0}>
                          <Text size="xs" c="dimmed">
                            Price
                          </Text>
                          <Text size="sm">
                            ${formatNumber(update.price, 2)}
                          </Text>
                        </Stack>
                      )}

                      {update.volume && (
                        <Stack gap={0}>
                          <Text size="xs" c="dimmed">
                            Volume
                          </Text>
                          <Text size="sm">
                            {formatNumber(update.volume, 0)}
                          </Text>
                        </Stack>
                      )}
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </ScrollArea>
        </Stack>
      </Stack>
    </Card>
  )
}
