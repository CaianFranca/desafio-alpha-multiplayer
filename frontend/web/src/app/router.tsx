import { createBrowserRouter } from 'react-router-dom'
import { App } from './App'
import { HomePage } from '../pages/HomePage'
import { CadastroPage } from '../pages/stubs/CadastroPage'
import { LoginPage } from '../pages/stubs/LoginPage'
export const routes = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'cadastro', element: <CadastroPage /> },
      { path: 'login', element: <LoginPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
