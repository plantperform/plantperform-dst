import { Route, Routes } from 'react-router-dom'

import { CreateFarmPage } from '@/pages/CreateFarmPage'
import { FarmDetailPage } from '@/pages/FarmDetailPage'
import { HomePage } from '@/pages/HomePage'

const App = () => (
  <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/farms/new" element={<CreateFarmPage />} />
    <Route path="/farms/:farmId" element={<FarmDetailPage />} />
  </Routes>
)

export default App
