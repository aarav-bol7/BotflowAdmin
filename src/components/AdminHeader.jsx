import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, User, LogOut, Bell, CheckCircle2, AlertCircle, Info, X, Mail, Phone, Edit2, Save, XCircle, Camera, Menu } from 'lucide-react';
import { getAdminData, logout } from '../utils/adminAuthUtils';
import toast from 'react-hot-toast';

function AdminHeader({ title = 'Admin Dashboard', subtitle = 'System Administration', onMenuClick }) {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({ name: '', email: '', phone: '', role: '' });
  const profileMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const defaultProfileImage = 'https://chat.bol7.com/Files/Whatsapp_251218044725.png';
  
  // Mock notifications - in real app, this would come from API
  const [notifications] = useState([
    { id: 1, type: 'success', title: 'System Update', message: 'All systems are running smoothly', time: '2 minutes ago', read: false },
    { id: 2, type: 'info', title: 'New User Registered', message: 'A new user has joined the platform', time: '15 minutes ago', read: false },
    { id: 3, type: 'warning', title: 'High Traffic Alert', message: 'Traffic is 20% higher than usual', time: '1 hour ago', read: true },
  ]);
  
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    const data = getAdminData();
    if (!data) {
      // Set default admin data if not exists
      const defaultData = {
        name: 'Admin User',
        email: 'admin@example.com',
        phone: '',
        role: 'Administrator'
      };
      setAdminData(defaultData);
    } else {
      setAdminData(data);
    }
    // Load saved profile data from localStorage
    const savedProfile = localStorage.getItem('adminProfile');
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        setAdminData(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Error loading profile:', e);
      }
    }

    // Listen for profile image updates
    const handleImageUpdate = () => {
      // Force re-render by updating state
      setAdminData(prev => ({ ...prev }));
    };
    window.addEventListener('profileImageUpdated', handleImageUpdate);
    return () => {
      window.removeEventListener('profileImageUpdated', handleImageUpdate);
    };
  }, []);

  useEffect(() => {
    if (adminData && !isEditing) {
      setEditedData({
        name: adminData.name || '',
        email: adminData.email || '',
        phone: adminData.phone || '',
        role: adminData.role || 'Administrator'
      });
    }
  }, [adminData, isEditing]);

  useEffect(() => {
    if (showProfileMenu) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showProfileMenu]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
      if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLogout = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    try {
      await logout();
      localStorage.removeItem('adminProfile');
      localStorage.removeItem('adminProfileImage');
      setShowProfileMenu(false);
      setIsEditing(false);
      toast.success('Logged out successfully');
      setTimeout(() => {
        window.location.href = '/login?logout=true';
      }, 200);
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/login';
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = () => {
    const updatedData = { ...adminData, ...editedData };
    setAdminData(updatedData);
    localStorage.setItem('adminProfile', JSON.stringify(editedData));
    setIsEditing(false);
    toast.success('Profile updated successfully');
  };

  const handleCancel = () => {
    setEditedData({
      name: adminData?.name || '',
      email: adminData?.email || '',
      phone: adminData?.phone || '',
      role: adminData?.role || 'Administrator'
    });
    setIsEditing(false);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageUrl = reader.result;
        localStorage.setItem('adminProfileImage', imageUrl);
        window.dispatchEvent(new Event('profileImageUpdated'));
        toast.success('Profile image updated');
      };
      reader.readAsDataURL(file);
    }
  };

  const getProfileImage = () => {
    const savedImage = localStorage.getItem('adminProfileImage');
    return savedImage || defaultProfileImage;
  };

  if (!adminData) {
    return null;
  }

  return (
    <>
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-950 border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm">
        <div className="w-full h-16 px-4 sm:px-6 lg:px-8 flex items-center">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              {/* Mobile Menu Button */}
              <button
                onClick={onMenuClick}
                className="lg:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                title="Menu"
              >
                <Menu className="w-6 h-6 text-slate-600 dark:text-slate-400" />
              </button>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 dark:from-indigo-500 dark:to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <Shield className="w-6 h-6" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">{title}</h1>
                {subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{subtitle}</p>
                )}
              </div>
              <div className="sm:hidden">
                <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight truncate max-w-[120px]">{title}</h1>
              </div>
            </div>

            {/* Notifications & Profile Menu */}
            <div className="flex items-center gap-2">
              {/* Notifications */}
              <div className="relative" ref={notificationMenuRef}>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 hover:scale-110 hover:shadow-md"
                  title="Notifications"
                >
                  <Bell className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-950">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-800/50 py-2 z-50 animate-scale-in max-h-96 overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h3>
                      <button
                        onClick={() => setShowNotifications(false)}
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      </button>
                    </div>

                    {/* Notifications List */}
                    <div className="overflow-y-auto flex-1">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                          <Bell className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                          <p className="text-sm text-slate-500 dark:text-slate-400">No notifications</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                          {notifications.map((notification) => {
                            const IconComponent = 
                              notification.type === 'success' ? CheckCircle2 :
                              notification.type === 'warning' ? AlertCircle :
                              Info;
                            const iconColor =
                              notification.type === 'success' ? 'text-green-600 dark:text-green-400' :
                              notification.type === 'warning' ? 'text-yellow-600 dark:text-yellow-400' :
                              'text-blue-600 dark:text-blue-400';
                            
                            return (
                              <div
                                key={notification.id}
                                className={`px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                                  !notification.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`p-1.5 rounded-lg ${iconColor} bg-opacity-10 flex-shrink-0 mt-0.5`}>
                                    <IconComponent className={`w-4 h-4 ${iconColor}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                                      {notification.title}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                      {notification.message}
                                    </p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                      {notification.time}
                                    </p>
                                  </div>
                                  {!notification.read && (
                                    <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2"></div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                      <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800">
                        <button 
                          onClick={() => {
                            setShowNotifications(false);
                            navigate('/notifications');
                          }}
                          className="w-full text-xs text-center text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium py-1"
                        >
                          View all notifications
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Profile Button */}
              <div className="relative" ref={profileMenuRef}>
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 hover:shadow-md"
                >
                  <div className="relative w-9 h-9">
                    <img
                      src={getProfileImage()}
                      alt="Profile"
                      className="w-9 h-9 rounded-full object-cover shadow-md border-2 border-white dark:border-slate-800"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        const fallback = e.target.parentElement.querySelector('.fallback-avatar');
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div className="fallback-avatar w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 text-white items-center justify-center text-sm font-bold shadow-md shadow-indigo-500/30 hidden absolute inset-0">
                      {adminData?.name?.charAt(0)?.toUpperCase() || adminData?.email?.charAt(0)?.toUpperCase() || 'A'}
                    </div>
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {adminData?.name || adminData?.email || 'Admin'}
                    </p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Profile Modal - Rendered outside header */}
      {showProfileMenu && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-[100]"
            onClick={() => {
              setShowProfileMenu(false);
              setIsEditing(false);
            }}
          ></div>
          
          {/* Modal */}
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-2 sm:p-4 pointer-events-none">
            <div 
              className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/50 dark:border-slate-800/50 animate-scale-in pointer-events-auto max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {adminData?.name || 'Profile'}
                </h3>
                <button
                  onClick={() => {
                    setShowProfileMenu(false);
                    setIsEditing(false);
                  }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>

              {/* Content */}
              <div className="overflow-y-auto flex-1 p-6">
                {/* Profile Image */}
                <div className="flex flex-col items-center mb-6">
                  <div className="relative">
                    <img
                      src={getProfileImage()}
                      alt="Profile"
                      className="w-24 h-24 rounded-full object-cover shadow-lg border-4 border-white dark:border-slate-800"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        const fallback = e.target.parentElement.querySelector('.fallback-avatar-large');
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div className="fallback-avatar-large w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 dark:from-indigo-600 dark:to-purple-700 text-white items-center justify-center text-2xl font-bold shadow-lg shadow-indigo-500/30 hidden">
                      {adminData?.name?.charAt(0)?.toUpperCase() || adminData?.email?.charAt(0)?.toUpperCase() || 'A'}
                    </div>
                    {isEditing && (
                      <label className="absolute bottom-0 right-0 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full cursor-pointer shadow-lg transition-colors">
                        <Camera className="w-4 h-4" />
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                  <h4 className="text-xl font-bold text-slate-900 dark:text-white mt-4">
                    {isEditing ? editedData.name : adminData?.name || 'Admin User'}
                  </h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {isEditing ? editedData.role : adminData?.role || 'Administrator'}
                  </p>
                </div>

                {/* Profile Details */}
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Full Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.name}
                        onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        placeholder="Enter your name"
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm text-slate-900 dark:text-white">{adminData?.name || 'Not set'}</span>
                      </div>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email Address
                    </label>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editedData.email}
                        onChange={(e) => setEditedData({ ...editedData, email: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        placeholder="Enter your email"
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm text-slate-900 dark:text-white">{adminData?.email || 'Not set'}</span>
                      </div>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Phone Number
                    </label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedData.phone}
                        onChange={(e) => setEditedData({ ...editedData, phone: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        placeholder="Enter your phone"
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <Phone className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm text-slate-900 dark:text-white">{adminData?.phone || 'Not set'}</span>
                      </div>
                    )}
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Role
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedData.role}
                        onChange={(e) => setEditedData({ ...editedData, role: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        placeholder="Enter your role"
                      />
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                        <span className="text-sm text-slate-900 dark:text-white">{adminData?.role || 'Administrator'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end">
                <button
                  type="button"
                  onClick={(e) => handleLogout(e)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default AdminHeader;
