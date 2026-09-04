import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanup } from '@testing-library/react'
import { DurationStepper } from '../DurationStepper'

describe('DurationStepper (v1.1 F1)', () => {
  afterEach(cleanup)

  it('renders the value and +/- buttons adjust within range', () => {
    const onChange = vi.fn()
    render(<DurationStepper value={25} onChange={onChange} min={1} max={180} ariaLabel="专注时长" />)

    fireEvent.click(screen.getByRole('button', { name: '减少' }))
    expect(onChange).toHaveBeenCalledWith(24)

    fireEvent.click(screen.getByRole('button', { name: '增加' }))
    expect(onChange).toHaveBeenCalledWith(26)
  })

  it('commits a valid typed value on Enter and on blur', () => {
    const onChange = vi.fn()
    render(<DurationStepper value={25} onChange={onChange} min={1} max={180} ariaLabel="专注时长" />)

    const input = screen.getByRole('textbox', { name: '专注时长' })
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(30)

    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(45)
  })

  it('rejects invalid input with an inline error and no onChange', () => {
    const onChange = vi.fn()
    render(<DurationStepper value={25} onChange={onChange} min={1} max={180}
      ariaLabel="专注时长" errorMessage="请输入 1–180 的整数分钟" />)

    const input = screen.getByRole('textbox', { name: '专注时长' })

    for (const bad of ['0', '500', 'abc', '3.5', '-4']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.blur(input)
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toBe('请输入 1–180 的整数分钟')
      fireEvent.change(input, { target: { value: '25' } })
    }
  })

  it('Escape reverts to the last committed value', () => {
    const onChange = vi.fn()
    render(<DurationStepper value={25} onChange={onChange} min={1} max={180} ariaLabel="专注时长" />)

    const input = screen.getByRole('textbox', { name: '专注时长' })
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect((input as HTMLInputElement).value).toBe('25')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('allows a temporarily empty field without committing', () => {
    const onChange = vi.fn()
    render(<DurationStepper value={25} onChange={onChange} min={1} max={180} ariaLabel="专注时长" />)

    const input = screen.getByRole('textbox', { name: '专注时长' })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('')
  })
})
