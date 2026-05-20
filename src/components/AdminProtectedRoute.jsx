import { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { validateAuthSession } from '../utils/adminAuthUtils';

const AdminProtectedRoute = ({ children }) => {
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const valid = await validateAuthSession();
      setAuthenticated(valid);
      setIsChecking(false);
    };

    checkAuth();
  }, [location.pathname]);

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default AdminProtectedRoute;
