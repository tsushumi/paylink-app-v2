import { useState, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PaymentPage from './pages/PaymentPage.jsx';

const KEY = 'paylink:user';

function loadUser() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(loadUser);

  const signIn = useCallback((u) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(u));
    } catch {
      /* storage unavailable - session only */
    }
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  return (
    <Routes>
      <Route path="/pay/:linkId" element={<PaymentPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onSignIn={signIn} />} />
      <Route
        path="/"
        element={user ? <Dashboard user={user} onSignOut={signOut} /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
