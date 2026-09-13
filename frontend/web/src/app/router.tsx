import { createBrowserRouter } from 'react-router-dom'
import { baseParaRouter } from '../api/basePath'
import { App } from './App'
import { RequireAuth } from './RequireAuth'
import { HomePage } from '../pages/HomePage'
import { CadastroPage } from '../pages/CadastroPage'
import { EntrarPage } from '../pages/EntrarPage'
import { SalasCriarPage } from '../pages/stubs/SalasCriarPage'
import { SalaPage } from '../pages/SalaPage'
import { PartidaPage } from '../pages/PartidaPage'
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
      {
        path: 'sala/:codigoDeSala',
        element: (
          <RequireAuth>
            <SalaPage />
          </RequireAuth>
        ),
      },
      {
        path: 'salas/:codigoDeSala',
        element: (
          <RequireAuth>
            <SalaPage />
          </RequireAuth>
        ),
      },
      {
        path: 'convite/:codigoDeSala',
        element: (
          <RequireAuth>
            <SalaPage />
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

// Basename acompanha o subpath do build ('' na raiz, '/server01' sob
// VITE_BASE_PATH=/server01/) para as rotas SPA resolverem sob o prefixo.
export const router = createBrowserRouter(routes, { basename: baseParaRouter() })
