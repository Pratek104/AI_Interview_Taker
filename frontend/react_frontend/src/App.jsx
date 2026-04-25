import { Navigate, Route, Routes } from 'react-router-dom'
import { LandingPage } from './pages/LandingPage'
import { UploadPage } from './pages/UploadPage'
import { RolePage } from './pages/RolePage'
import { ModePage } from './pages/ModePage'
import { InterviewPage } from './pages/InterviewPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/setup/cv" element={<UploadPage />} />
      <Route path="/setup/role" element={<RolePage />} />
      <Route path="/setup/mode" element={<ModePage />} />
      <Route path="/interview" element={<InterviewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
