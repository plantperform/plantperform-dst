import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/context'

export const ProtectedRoute = () => {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return null
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
