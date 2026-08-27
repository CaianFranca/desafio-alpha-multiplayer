import { createBrowserRouter } from 'react-router-dom'
import { App } from './App'
import { RequireAuth } from './RequireAuth'
import { HomePage } from '../pages/HomePage'
import { CadastroPage } from '../pages/CadastroPage'
import { EntrarPage } from '../pages/EntrarPage'
import { SalasCriarPage } from '../pages/stubs/SalasCriarPage'

export const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'cadastro', element: <CadastroPage /> },
      { path: 'login', element: <EntrarPage /> },
      {
        path: 'salas/criar',
        element: (
          <RequireAuth>
            <SalasCriarPage />
          </RequireAuth>
        ),
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
