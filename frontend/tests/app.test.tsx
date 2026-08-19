import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../web/src/app/router'

describe('frontend scaffold', () => {
  it('renders the home route content', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('heading', { name: /prepare-se para a partida/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar sala/i })).toBeInTheDocument()
  })
})
