import { createBrowserRouter } from 'react-router-dom'
import { App } from './App'
import { RequireAuth } from './RequireAuth'
import { HomePage } from '../pages/HomePage'
import { CadastroPage } from '../pages/stubs/CadastroPage'
import { LoginPage } from '../pages/stubs/LoginPage'
import { SalasCriarPage } from '../pages/stubs/SalasCriarPage'
import { PartidaPage } from '../pages/PartidaPage'
export const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'cadastro', element: <CadastroPage /> },
      { path: 'login', element: <LoginPage /> },
      {
        path: 'salas/criar',
        element: (
          <RequireAuth>
            <SalasCriarPage />
          </RequireAuth>
        ),
      },
      {
        path: 'partida',
        element: (
          <RequireAuth>
            <PartidaPage />
          </RequireAuth>
        ),
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
