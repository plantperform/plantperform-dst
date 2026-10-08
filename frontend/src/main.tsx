import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { OptimizationRunsProvider } from './api/OptimizationRunsProvider'
import { AuthProvider } from './auth/AuthProvider'
import { TooltipProvider } from './components/ui/tooltip'
import './index.css'
import App from './App.tsx'

const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AuthProvider>
        <OptimizationRunsProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </OptimizationRunsProvider>
      </AuthProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
