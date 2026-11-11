import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, LiveProvider, ToastProvider, useAuth } from './lib/providers.jsx'
import { AppShell } from './components/AppShell.jsx'
import { Loading } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import Orders from './pages/Orders.jsx'
import OrderDetail from './pages/OrderDetail.jsx'
import Disputes from './pages/Disputes.jsx'
import DisputeDetail from './pages/DisputeDetail.jsx'
import Settings from './pages/Settings.jsx'
import Store from './pages/Store.jsx'
import StoreOrder from './pages/StoreOrder.jsx'
import StoreTrack from './pages/StoreTrack.jsx'

function RequireAuth({ children }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <Loading label="Opening your workspace" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <LiveProvider>{children}</LiveProvider>
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/store" element={<Store />} />
          <Route path="/store/track" element={<StoreTrack />} />
          <Route path="/store/orders/:token" element={<StoreOrder />} />
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:orderId" element={<OrderDetail />} />
            <Route path="disputes" element={<Disputes />} />
            <Route path="disputes/:disputeId" element={<DisputeDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  )
}
