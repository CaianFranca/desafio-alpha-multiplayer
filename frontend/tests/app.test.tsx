import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../web/src/app/App'
import { HomePage } from '../web/src/pages/HomePage'

describe('frontend scaffold', () => {
  it('renders the home route content', () => {
    render(<MemoryRouter><App /></MemoryRouter>)
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar sala/i })).toBeInTheDocument()
  })
})
