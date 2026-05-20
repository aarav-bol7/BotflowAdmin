import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';

function AdminLayout() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Determine title and subtitle based on current route
  const getPageInfo = () => {
    switch (location.pathname) {
      case '/bot':
        return { title: 'Bot Management', subtitle: 'Manage and configure bots' };
      case '/global-default':
        return { title: 'Global Default', subtitle: 'Configure global default models' };
      case '/ai-agent':
        return { title: 'AI Agent', subtitle: 'Configure AI agent providers and models' };
      case '/call-details':
        return { title: 'Call Details', subtitle: 'View and manage call sessions' };
      case '/chat-messages':
        return { title: 'Chat Messages', subtitle: 'View and manage chat sessions' };
      case '/notifications':
        return { title: 'Notifications', subtitle: 'View and manage notifications' };
      case '/user-management':
        return { title: 'User Management', subtitle: 'Manage bots, clients, users, and tokens' };
      case '/bot-analytics':
        return { title: 'Bot Analytics', subtitle: 'Real-time bot monitoring and analytics' };
      case '/dashboard':
        return { title: 'Admin Dashboard', subtitle: 'System Administration' };
      default:
        return { title: 'Admin Panel', subtitle: 'System Administration' };
    }
  };

  const { title, subtitle } = getPageInfo();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex">
      {/* Admin Sidebar - Persistent across all pages */}
      <AdminSidebar isMobileOpen={isMobileMenuOpen} setIsMobileOpen={setIsMobileMenuOpen} />

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-72 flex flex-col min-h-screen w-full">
        {/* Header - Persistent across all pages, dynamically updated */}
        <AdminHeader
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />

        {/* Main Content - This is where page content will be rendered */}
        <main className="flex-1 overflow-y-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;
