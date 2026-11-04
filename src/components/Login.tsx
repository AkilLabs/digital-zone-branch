import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';

import { getRoleBasedDestination } from '../utils/secureAuth';
import { getAuthErrorMessage } from '../utils/authErrors';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, currentUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Auto-redirect if already logged in
  useEffect(() => {
    if (!authLoading && currentUser) {
      const destination = getRoleBasedDestination(currentUser.role);
      navigate(destination, { replace: true });
    }
  }, [currentUser, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      const user = await login(email, password);

      const destination = getRoleBasedDestination(user.role);
      navigate(destination, { replace: true });
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-slate-100/70 p-4">
      <div className="bg-white p-8 sm:p-10 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        {/* Logo and Business Name */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 mb-4 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-xs flex items-center justify-center">
            <img
              src={logo}
              alt="Digital Zone Logo"
              className="h-16 sm:h-20 w-auto max-w-[260px] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
            />
          </div>
          <h1 className="text-center text-slate-900 mb-1 text-3xl font-bold tracking-tight">Digital Zone</h1>
          <p className="text-center text-slate-500 text-sm font-medium mb-3">Sales | Service | Accessory</p>
          <h2 className="text-center text-slate-400 text-xs font-semibold uppercase tracking-wider">Login</h2>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3.5 rounded-lg mb-6 border border-red-200 flex items-start gap-3">
            <svg
              className="w-5 h-5 mt-0.5 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-medium flex-1">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label htmlFor="email" className="block mb-2 text-gray-700 font-medium text-sm">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="block mb-2 text-gray-700 font-medium text-sm">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-base transition-all duration-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3.5 bg-blue-500 text-white border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-200 shadow-sm hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(59,130,246,0.3)] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;