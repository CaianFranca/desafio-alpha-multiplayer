import { createBrowserRouter } from 'react-router-dom'
import { App } from './App'
import { HomePage } from '../pages/HomePage'
import { CadastroPage } from '../pages/stubs/CadastroPage'
import { LoginPage } from '../pages/stubs/LoginPage'
import { CriarSalaPage } from '../pages/stubs/CriarSalaPage'

export const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'cadastro', element: <CadastroPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'salas/criar', element: <CriarSalaPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
