import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('Abyssal Reverie', () => {
  it('renders the timer and main navigation', () => {
    render(<App />)
    expect(screen.getByText((_, element) => element?.textContent === '25:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始专注' })).toBeInTheDocument()
    expect(screen.getByText('今日概览')).toBeInTheDocument()
  })
})
