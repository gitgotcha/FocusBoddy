import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'
import { GatewayProvider } from './services/gatewayContext'
import { FakeAppGateway } from './test/FakeAppGateway'

afterEach(() => cleanup())

function renderWithGateway(gateway: FakeAppGateway) {
  return render(
    <GatewayProvider gateway={gateway}>
      <App />
    </GatewayProvider>,
  )
}

describe('Abyssal Reverie', () => {
  it('renders the timer and main navigation', async () => {
    const gateway = new FakeAppGateway()
    renderWithGateway(gateway)

    // bootstrap resolves asynchronously; the timer chrome is present immediately.
    expect(await screen.findByText((_, el) => el?.textContent === '25:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始专注' })).toBeInTheDocument()
    expect(screen.getByText('今日概览')).toBeInTheDocument()
  })

  it('persists a created task through the gateway', async () => {
    const gateway = new FakeAppGateway()
    const user = userEvent.setup()
    renderWithGateway(gateway)

    // Navigate to the Tasks panel (exact match avoids hitting "删除任务").
    await user.click(screen.getByRole('button', { name: '任务' }))

    const input = await screen.findByPlaceholderText('添加任务…')
    await user.type(input, '编写集成测试')
    await user.keyboard('{Enter}')

    // The new task card appears in the active list and is seeded into the fake gateway.
    await waitFor(() => {
      expect(screen.getByText('编写集成测试')).toBeInTheDocument()
    })
    const payload = await gateway.bootstrap()
    expect(payload.tasks.some((t) => t.title === '编写集成测试')).toBe(true)
  })

  it('deletes a task through the gateway', async () => {
    const gateway = new FakeAppGateway()
    const user = userEvent.setup()
    renderWithGateway(gateway)

    // Create a task, then delete it via its task-card delete button.
    await user.click(screen.getByRole('button', { name: '任务' }))
    const input = await screen.findByPlaceholderText('添加任务…')
    await user.type(input, '临时任务')
    await user.keyboard('{Enter}')

    await screen.findByText('临时任务')
    // The delete button is the one with aria-label="删除任务" inside the same row.
    const deleteButton = screen.getAllByRole('button', { name: '删除任务' })[0]
    await user.click(deleteButton)

    await waitFor(() => {
      expect(screen.queryByText('临时任务')).not.toBeInTheDocument()
    })
    const payload = await gateway.bootstrap()
    expect(payload.tasks.some((t) => t.title === '临时任务')).toBe(false)
  })
})
