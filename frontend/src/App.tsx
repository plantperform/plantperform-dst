import { Route, Routes } from 'react-router-dom'

import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { AuthPage } from '@/pages/AuthPage'
import { CreateFarmPage } from '@/pages/CreateFarmPage'
import { FarmDetailPage } from '@/pages/FarmDetailPage'
import { HomePage } from '@/pages/HomePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { VerifyEmailPage } from '@/pages/VerifyEmailPage'

const App = () => (
  <Routes>
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/profil" element={<ProfilePage />} />
      <Route path="/farms/new" element={<CreateFarmPage />} />
      <Route path="/farms/:farmId" element={<FarmDetailPage />} />
    </Route>
  </Routes>
)

export default App
