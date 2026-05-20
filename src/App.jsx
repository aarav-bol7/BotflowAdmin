import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Login from './pages/Login';
import Bot from './pages/Bot';
import DeletedBots from './pages/DeletedBots';
import Notifications from './pages/Notifications';
import CallDetails from './pages/CallDetails';
import ChatMessages from './pages/ChatMessages';
import GlobalDefault from './pages/GlobalDefault';
import UserManagement from './pages/UserManagement';
import BotAnalytics from './pages/BotAnalytics';
import AIAgent from './pages/AIAgent';
import MultiLLMChat from './pages/MultiLLMChat';
import AdminProtectedRoute from './components/AdminProtectedRoute';
import AdminLayout from './components/AdminLayout';
import { startTokenExpiryWatcher, stopTokenExpiryWatcher, isAuthenticated } from './utils/adminAuthUtils';

function AppRoutes() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  useEffect(() => {
    if (!isLoginPage && isAuthenticated()) {
      startTokenExpiryWatcher(30000);
    } else {
      stopTokenExpiryWatcher();
    }
    return () => stopTokenExpiryWatcher();
  }, [isLoginPage]);

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />

      {/* Protected Admin Routes with Persistent Layout */}
      <Route
        element={
          <AdminProtectedRoute>
            <AdminLayout />
          </AdminProtectedRoute>
        }
      >
        <Route path="/bot" element={<Bot />} />
        <Route path="/bot-archive" element={<DeletedBots />} />
        <Route path="/global-default" element={<GlobalDefault />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/call-details" element={<CallDetails />} />
        <Route path="/chat-messages" element={<ChatMessages />} />
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/bot-analytics" element={<BotAnalytics />} />
        <Route path="/ai-agent" element={<AIAgent />} />
        <Route path="/multillm-chat" element={<MultiLLMChat />} />
      </Route>

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <>
      <Toaster position="bottom-right" />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </>
  );
}

export default App;
