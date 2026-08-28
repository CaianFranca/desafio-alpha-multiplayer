import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider } from './state/AuthProvider'
import './styles/global.css'

/**
 * Sem StrictMode: o duplo montagem/desmonte do StrictMode quebra o Canvas do
 * react-three-fiber v9 (React 19 + three 0.185) — o desmonte descarta o
 * contexto WebGL e o remonte não pinta, deixando o Ambiente de Jogo em
 * branco (diagnóstico da issue #75, reprodução determinística com GPU local).
 * Reavaliar ao atualizar o react-three-fiber.
 */
createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>,
)
