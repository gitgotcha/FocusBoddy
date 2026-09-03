import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { TauriAppGateway } from '../tauriAppGateway'

describe('TauriAppGateway', () => {
  beforeEach(() => invokeMock.mockReset())

  it('maps every timer action to its Rust command', async () => {
    invokeMock.mockResolvedValue({})
    const gateway = new TauriAppGateway()

    await gateway.startTimer({ mode: 'focus', selectedTaskId: null, expectedRevision: 0 })
    await gateway.pauseTimer({ expectedRevision: 1 })
    await gateway.resumeTimer({ expectedRevision: 2 })
    await gateway.resetTimer({ expectedRevision: 3 })
    await gateway.switchTimerMode({ mode: 'short', expectedRevision: 4 })
    await gateway.completeTimer({ activeSessionId: 'session-1', expectedRevision: 5 })

    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      'start_timer',
      'pause_timer',
      'resume_timer',
      'reset_timer',
      'switch_timer_mode',
      'complete_timer',
    ])
    expect(invokeMock).toHaveBeenCalledWith('start_timer', {
      input: { mode: 'focus', selectedTaskId: null, expectedRevision: 0 },
    })
  })

  it('passes explicit statistics day boundaries unchanged', async () => {
    invokeMock.mockResolvedValue([])
    const gateway = new TauriAppGateway()
    const query = {
      from: 0,
      to: 172800000,
      days: [
        { date: '1970-01-01', from: 0, to: 86400000 },
        { date: '1970-01-02', from: 86400000, to: 172800000 },
      ],
    }

    await gateway.getStatistics(query)
    expect(invokeMock).toHaveBeenCalledWith('get_statistics', { query })
  })
})
