// Theme management utilities
export const getTheme = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('theme') || 'light';
  }
  return 'light';
};

export const setTheme = (theme) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
};

export const toggleTheme = () => {
  const currentTheme = getTheme();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  return newTheme;
};

// Initialize theme on load
if (typeof window !== 'undefined') {
  const savedTheme = getTheme();
  setTheme(savedTheme);
}
