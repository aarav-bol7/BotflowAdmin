import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Shield, Sun, Moon, LogOut, Bot, Bell, Menu, X, Phone, MessageSquare, Settings, Users, BarChart3, Brain, Archive, Sparkles
} from 'lucide-react';
import { getAdminData, logout } from '../utils/adminAuthUtils';
import { getTheme, toggleTheme } from '../utils/themeUtils';
import toast from 'react-hot-toast';

function AdminSidebar({ isMobileOpen, setIsMobileOpen }) {
  const location = useLocation();
  const navigate = useNavigate();
  const adminData = getAdminData();
  const [currentTheme, setCurrentTheme] = useState(getTheme());

  useEffect(() => {
    setCurrentTheme(getTheme());
    const handleThemeChange = () => {
      setCurrentTheme(getTheme());
    };
    window.addEventListener('storage', handleThemeChange);
    return () => {
      window.removeEventListener('storage', handleThemeChange);
    };
  }, []);

  const handleThemeToggle = () => {
    const newTheme = toggleTheme();
    setCurrentTheme(newTheme);
    toast.success(`Switched to ${newTheme === 'dark' ? 'dark' : 'light'} mode`);
  };

  const handleLogout = async () => {
    try {
      await logout();
      localStorage.removeItem('adminProfile');
      localStorage.removeItem('adminProfileImage');
      toast.success('Logged out successfully');
      window.location.href = '/login?logout=true';
    } catch (error) {
      console.error('Error during logout:', error);
      window.location.href = '/login';
    }
  };

  const menuItems = [
    {
      title: 'Flows',
      description: 'Manage and configure flows',
      icon: Bot,
      path: '/bot',
    },
    {
      title: 'Deleted Bots',
      description: 'Archived bots pending permanent purge',
      icon: Archive,
      path: '/bot-archive',
    },
    {
      title: 'Global Default',
      description: 'Configure global default models',
      icon: Settings,
      path: '/global-default',
    },
    {
      title: 'AI Agent',
      description: 'Configure AI agent providers',
      icon: Brain,
      path: '/ai-agent',
    },
    {
      title: 'Call Details',
      description: 'View and manage call sessions',
      icon: Phone,
      path: '/call-details',
    },
    {
      title: 'Chat Messages',
      description: 'View and manage chat sessions',
      icon: MessageSquare,
      path: '/chat-messages',
    },
    {
      title: 'Notifications',
      description: 'View and manage notifications',
      icon: Bell,
      path: '/notifications',
    },
    {
      title: 'User Management',
      description: 'Manage bots, clients, users, and tokens',
      icon: Users,
      path: '/user-management',
    },
    {
      title: 'Bot Analytics',
      description: 'Real-time bot monitoring and analytics',
      icon: BarChart3,
      path: '/bot-analytics',
    },
    {
      title: 'MultiLLM Chat',
      description: 'Configure models from the LiteLLM gateway',
      icon: Sparkles,
      path: '/multillm-chat',
    },
  ];

  const isActive = (path) => {
    return location.pathname === path;
  };

  const handleLinkClick = () => {
    if (setIsMobileOpen) {
      setIsMobileOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-72 flex-col border-r border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-b from-white via-white to-slate-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950/50 backdrop-blur-sm z-50 shadow-xl">
      {/* Header */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-indigo-50/50 to-blue-50/50 dark:from-indigo-950/30 dark:to-blue-950/30">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 dark:from-indigo-500 dark:to-indigo-600 text-white grid place-content-center font-bold shadow-lg shadow-indigo-500/30">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-white">Admin Panel</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Control Center</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="text-sm space-y-1.5 px-3">
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            const active = isActive(item.path);
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={handleLinkClick}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                    active
                      ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 text-white shadow-lg shadow-indigo-500/30 border-l-4 border-indigo-300 dark:border-indigo-400'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-slate-100 hover:to-slate-50 dark:hover:from-slate-800 dark:hover:to-slate-800/50 hover:shadow-md hover:translate-x-1'
                  }`}
                >
                  {IconComponent && (
                    <IconComponent 
                      className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                        active ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110'
                      }`} 
                    />
                  )}
                  <span className={`flex-1 font-medium ${active ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                    {item.title}
                  </span>
                  {active && (
                    <div className="w-2 h-2 rounded-full bg-white/80 animate-pulse"></div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Theme Toggle & Logout */}
      <div className="px-3 py-3 border-t border-slate-200/50 dark:border-slate-800/50 space-y-2">
        <button
          onClick={handleThemeToggle}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-slate-100 hover:to-slate-50 dark:hover:from-slate-800 dark:hover:to-slate-800/50 hover:shadow-md transition-all duration-200 group"
          title={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {currentTheme === 'dark' ? (
            <Sun className="w-5 h-5 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110 transition-transform duration-200" />
          ) : (
            <Moon className="w-5 h-5 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110 transition-transform duration-200" />
          )}
          <span className="flex-1 font-medium text-left">
            {currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>
        
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-gradient-to-r hover:from-red-50 hover:to-red-50/50 dark:hover:from-red-900/20 dark:hover:to-red-900/10 hover:shadow-md transition-all duration-200 group border border-red-200 dark:border-red-800/50"
          title="Logout from admin panel"
        >
          <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
          <span className="flex-1 font-medium text-left">Logout</span>
        </button>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:from-slate-800/30 dark:to-transparent">
        <div className="text-xs text-slate-500 dark:text-slate-400 font-medium text-center">
          <div className="flex items-center justify-center gap-2">
            <Shield className="w-3 h-3" />
            <span>Secure Admin Portal</span>
          </div>
        </div>
      </div>
    </aside>

      {/* Mobile Sidebar */}
      <aside
        className={`lg:hidden fixed left-0 top-0 bottom-0 w-72 flex-col border-r border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-b from-white via-white to-slate-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950/50 backdrop-blur-sm z-50 shadow-xl transform transition-transform duration-300 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile Header */}
        <div className="h-16 flex items-center justify-between gap-3 px-5 border-b border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-indigo-50/50 to-blue-50/50 dark:from-indigo-950/30 dark:to-blue-950/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 dark:from-indigo-500 dark:to-indigo-600 text-white grid place-content-center font-bold shadow-lg shadow-indigo-500/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">Admin Panel</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Control Center</div>
            </div>
          </div>
          <button
            onClick={() => setIsMobileOpen(false)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Mobile Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="text-sm space-y-1.5 px-3">
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={handleLinkClick}
                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                      active
                        ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 text-white shadow-lg shadow-indigo-500/30 border-l-4 border-indigo-300 dark:border-indigo-400'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-slate-100 hover:to-slate-50 dark:hover:from-slate-800 dark:hover:to-slate-800/50 hover:shadow-md hover:translate-x-1'
                    }`}
                  >
                    {IconComponent && (
                      <IconComponent 
                        className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                          active ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110'
                        }`} 
                      />
                    )}
                    <span className={`flex-1 font-medium ${active ? 'text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                      {item.title}
                    </span>
                    {active && (
                      <div className="w-2 h-2 rounded-full bg-white/80 animate-pulse"></div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Mobile Theme Toggle & Logout */}
        <div className="px-3 py-3 border-t border-slate-200/50 dark:border-slate-800/50 space-y-2">
          <button
            onClick={handleThemeToggle}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-gradient-to-r hover:from-slate-100 hover:to-slate-50 dark:hover:from-slate-800 dark:hover:to-slate-800/50 hover:shadow-md transition-all duration-200 group"
            title={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {currentTheme === 'dark' ? (
              <Sun className="w-5 h-5 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110 transition-transform duration-200" />
            ) : (
              <Moon className="w-5 h-5 text-slate-500 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:scale-110 transition-transform duration-200" />
            )}
            <span className="flex-1 font-medium text-left">
              {currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
          
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-gradient-to-r hover:from-red-50 hover:to-red-50/50 dark:hover:from-red-900/20 dark:hover:to-red-900/10 hover:shadow-md transition-all duration-200 group border border-red-200 dark:border-red-800/50"
            title="Logout from admin panel"
          >
            <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
            <span className="flex-1 font-medium text-left">Logout</span>
          </button>
        </div>

        {/* Mobile Footer */}
        <div className="px-5 py-4 border-t border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:from-slate-800/30 dark:to-transparent">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium text-center">
            <div className="flex items-center justify-center gap-2">
              <Shield className="w-3 h-3" />
              <span>Secure Admin Portal</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default AdminSidebar;
