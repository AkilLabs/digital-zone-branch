import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAttendance } from '@/context/AttendanceContext';
import { useStore } from '../context/StoreContext';
import { useNavigate } from 'react-router-dom';
import { hasRouteAccess } from '../config/rolePermissions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import logo from '../assets/logo.png';

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const { isCheckedIn } = useAttendance();
  const { currentStore, stores, setCurrentStore, isHubUser, currentHub } = useStore();
  const navigate = useNavigate();
  const [showSidebar, setShowSidebar] = useState(false);
  const [showStoreSwitcher, setShowStoreSwitcher] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const storeSwitcherRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser?.role === 'owner';
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'store-admin' || currentUser?.role === 'hub-admin';
  const isEmployee = currentUser?.role === 'employee';

  // Navigation visibility logic
  const showNavigation = isOwner || isAdmin || (isEmployee && isCheckedIn);

  // Role-based route access check helper
  const canAccess = useCallback((path: string) => {
    if (!currentUser) return false;
    return hasRouteAccess(currentUser.role, path);
  }, [currentUser]);

  // Recharge toggle state - synced with Firestore and localStorage
  const [rechargeEnabled, setRechargeEnabled] = useState<boolean>(() => {
    const cached = localStorage.getItem('recharge_enabled');
    return cached !== null ? cached === 'true' : true;
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'projectSettings'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.rechargeEnabled === 'boolean') {
          setRechargeEnabled(data.rechargeEnabled);
          localStorage.setItem('recharge_enabled', String(data.rechargeEnabled));
        }
      }
    }, (err) => {
      console.warn('Could not listen to projectSettings:', err);
    });

    const handleCustomEvent = (e: any) => {
      if (typeof e.detail?.rechargeEnabled === 'boolean') {
        setRechargeEnabled(e.detail.rechargeEnabled);
      } else {
        const cached = localStorage.getItem('recharge_enabled');
        if (cached !== null) {
          setRechargeEnabled(cached === 'true');
        }
      }
    };
    window.addEventListener('recharge-setting-changed', handleCustomEvent);

    return () => {
      unsub();
      window.removeEventListener('recharge-setting-changed', handleCustomEvent);
    };
  }, []);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setShowSidebar(false);
      }
    };

    if (showSidebar) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSidebar]);

  // Close store switcher when clicking outside
  useEffect(() => {
    const handleClickOutsideSwitcher = (event: MouseEvent) => {
      if (storeSwitcherRef.current && !storeSwitcherRef.current.contains(event.target as Node)) {
        setShowStoreSwitcher(false);
      }
    };
    if (showStoreSwitcher) {
      document.addEventListener('mousedown', handleClickOutsideSwitcher);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutsideSwitcher);
    };
  }, [showStoreSwitcher]);

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showSidebar) setShowSidebar(false);
        if (showStoreSwitcher) setShowStoreSwitcher(false);
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showSidebar, showStoreSwitcher]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
      alert('Failed to logout. Please try again.');
    }
  };

  const handleNavigation = (path: string) => {
    navigate(path);
    setShowSidebar(false);
  };

  return (
    <>
      <header className="bg-white text-gray-900 shadow-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex justify-between items-center py-2 sm:py-2.5 md:py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => showNavigation && setShowSidebar(!showSidebar)}
                className={`h-8 sm:h-9 md:h-10 w-auto max-w-[120px] flex items-center justify-center ${showNavigation ? 'cursor-pointer hover:opacity-80' : 'cursor-default opacity-100'} transition-opacity duration-200`}
                title={showNavigation ? "Open Navigation Menu" : "Check in to enable navigation"}
                disabled={!showNavigation}
              >
                <img src={logo} alt="Logo" className="h-full w-auto max-w-[110px] object-contain rounded-lg" />
              </button>
              <div>
                <h1 className="m-0 text-sm sm:text-base md:text-xl font-bold text-gray-900 leading-tight">{currentHub?.name || 'Digital Zone'}</h1>
                <div className="relative" ref={storeSwitcherRef}>
                  {isHubUser && stores.length > 0 ? (
                    <>
                      <button
                        onClick={() => setShowStoreSwitcher(!showStoreSwitcher)}
                        className="m-0 text-[10px] sm:text-xs flex items-center gap-1 text-blue-600 cursor-pointer hover:text-blue-700 transition-colors"
                      >
                        {currentStore ? (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                            {currentStore.name}
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>
                            {currentHub?.name} (Warehouse)
                          </>
                        )}
                        <svg className={`w-3 h-3 transition-transform ${showStoreSwitcher ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {showStoreSwitcher && (
                        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-2xl border border-gray-200 z-[100] py-1 animate-in fade-in slide-in-from-top-1">
                          <div className="px-3 py-2 border-b border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Switch Location</p>
                          </div>
                          <button
                            onClick={() => { setCurrentStore('hub_warehouse'); setShowStoreSwitcher(false); }}
                            className={`w-full text-left px-3 py-2.5 text-xs hover:bg-indigo-50 transition-colors flex items-center gap-2 ${!currentStore ? 'text-indigo-600 font-semibold bg-indigo-50' : 'text-gray-700'}`}
                          >
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>
                            <span>{currentHub?.name} (Warehouse)</span>
                            {!currentStore && <svg className="w-3.5 h-3.5 ml-auto text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                          </button>
                          <div className="border-t border-gray-100 my-0.5" />
                          {stores.map(store => (
                            <button
                              key={store.id}
                              onClick={() => { setCurrentStore(store.id!); setShowStoreSwitcher(false); }}
                              className={`w-full text-left px-3 py-2.5 text-xs hover:bg-blue-50 transition-colors flex items-center gap-2 ${store.id === currentStore?.id ? 'text-blue-600 font-semibold bg-blue-50' : 'text-gray-700'}`}
                            >
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                              <span>{store.name}</span>
                              {store.id === currentStore?.id && <svg className="w-3.5 h-3.5 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                            </button>
                          ))}
                          <div className="border-t border-gray-100 mt-1 pt-1">
                            <button
                              onClick={() => { setShowStoreSwitcher(false); navigate('/hub-dashboard'); }}
                              className="w-full text-left px-3 py-2.5 text-xs text-indigo-600 hover:bg-indigo-50 font-medium transition-colors flex items-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" /></svg>
                              Hub Dashboard
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : currentStore ? (
                    <p className="m-0 text-gray-500 text-[10px] sm:text-xs flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                      {currentStore.name}
                    </p>
                  ) : (
                    <p className="m-0 text-gray-500 text-[10px] sm:text-xs hidden md:block">Billing System</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <div className="text-center">
                <p className="m-0 text-[10px] sm:text-xs md:text-sm font-medium text-gray-900">{currentUser?.displayName}</p>
                <span className="inline-block bg-gray-100 text-gray-700 px-1.5 sm:px-2 md:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] md:text-xs uppercase font-semibold tracking-wider border border-gray-200 mt-0.5">
                  {currentUser?.role}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="px-2.5 sm:px-3 md:px-5 py-1 sm:py-1.5 md:py-2 rounded-lg font-semibold cursor-pointer transition-all duration-200 text-[10px] sm:text-xs md:text-sm bg-white text-red-500 border-2 border-red-500 hover:bg-red-500 hover:text-white hover:shadow-md"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {showSidebar && (
        <div
          className="fixed inset-0 bg-transparent bg-opacity-50 z-[60] transition-opacity duration-300"
          onClick={() => setShowSidebar(false)}
        />
      )}

      <div
        ref={sidebarRef}
        className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : '-translate-x-full'
          }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-auto max-w-[120px] flex items-center">
              <img src={logo} alt="Logo" className="h-full w-auto max-w-[110px] object-contain rounded-lg" />
            </div>
            <div>
              <h2 className="m-0 text-lg font-bold text-gray-900">Digital Zone</h2>
              <p className="m-0 text-xs text-gray-600">Navigation Menu</p>
            </div>
          </div>
          <button
            onClick={() => setShowSidebar(false)}
            className="p-2 rounded-lg hover:bg-gray-200 transition-colors duration-200"
            title="Close sidebar"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="p-4 overflow-y-auto h-[calc(100%-88px)] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] space-y-6">

          {/* Hub Menu (for hub-level users) */}
          {/* 
          isHubUser && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-indigo-400 uppercase tracking-wider">Hub Management</h3>
              <div className="space-y-1">
                <button
                  onClick={() => handleNavigation('/hub-dashboard')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  <span className="text-sm">Hub Dashboard</span>
                </button>
                <button
                  onClick={() => handleNavigation('/store-management')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-sm">Manage Stores</span>
                </button>
                <button
                  onClick={() => handleNavigation('/stock-transfer')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-indigo-600 hover:bg-indigo-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span className="text-sm">Stock Transfer</span>
                </button>
              </div>
            </div>
          )
          */}

          {/* Main Menu */}
          {!isEmployee && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Main Menu</h3>
              <div className="space-y-1">
                {canAccess('/dashboard') && (
                <button
                  onClick={() => handleNavigation('/dashboard')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <span className="text-sm">Home</span>
                </button>
                )}

                {canAccess('/billing') && (
                <button
                  onClick={() => handleNavigation('/billing')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm">Billing</span>
                </button>
                )}

                {canAccess('/quotations') && (
                <button
                  onClick={() => handleNavigation('/quotations')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm">Quotations</span>
                </button>
                )}

                {canAccess('/add-expense') && (
                <button
                  onClick={() => handleNavigation('/add-expense')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span className="text-sm">Add Expense</span>
                </button>
                )}

                {canAccess('/customers') && (
                <button
                  onClick={() => handleNavigation('/customers')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span className="text-sm">Customers</span>
                </button>
                )}
              </div>
            </div>
          )}

          {/* Recharge Operations */}
          {!isEmployee && rechargeEnabled && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Recharge</h3>
              <div className="space-y-1">
                <button
                  onClick={() => handleNavigation('/recharge-accounts')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm">Recharge Accounts</span>
                </button>

                <button
                  onClick={() => handleNavigation('/bulk-recharge')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-sm">Bulk Recharge</span>
                </button>

                {canAccess('/recharge-report') && (
                <button
                  onClick={() => handleNavigation('/recharge-report')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm">Recharge Report</span>
                </button>
                )}

                {canAccess('/provider-management') && (
                  <button
                    onClick={() => handleNavigation('/provider-management')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="text-sm">Providers</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Inventory & Stock */}
          <div>
            <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Inventory</h3>
            <div className="space-y-1">
              {!isEmployee && (
                <>
                  <button
                    onClick={() => handleNavigation('/products')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <span className="text-sm">Products</span>
                  </button>

                  
                  <button
                    onClick={() => handleNavigation('/tamper-labels')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2zM9 16h6m-6-4h6m-6-4h6" />
                    </svg>
                    <span className="text-sm">Tamper Box Labels</span>
                  </button>


                  {canAccess('/master') && (
                  <button
                    onClick={() => handleNavigation('/master')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <span className="text-sm">Master Settings</span>
                  </button>
                  )}

                  {canAccess('/purchases') && (
                  <button
                    onClick={() => handleNavigation('/purchases')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="text-sm">Purchases</span>
                  </button>
                  )}

                  {canAccess('/add-purchase') && (
                  <button
                    onClick={() => handleNavigation('/add-purchase')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9" />
                    </svg>
                    <span className="text-sm">Add Purchase</span>
                  </button>
                  )}

                  {canAccess('/add-purchase-imei') && (
                  <button
                    onClick={() => handleNavigation('/add-purchase-imei')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Add Purchase (IMEI)</span>
                  </button>
                  )}
                </>
              )}

              <button
                onClick={() => handleNavigation('/stock-requirement')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
              >
                <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <span className="text-sm">Stock Requirement</span>
              </button>

              {canAccess('/service-management') && (
              <button
                onClick={() => handleNavigation('/service-management')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
              >
                <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm">Service Management</span>
              </button>
              )}

              {canAccess('/service-management/create') && (
              <button
                onClick={() => handleNavigation('/service-management/create')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
              >
                <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm">New Service Job</span>
              </button>
              )}

              {!isEmployee && (
                <>
                  {canAccess('/suppliers') && (
                  <button
                    onClick={() => handleNavigation('/suppliers')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="text-sm">Suppliers</span>
                  </button>
                  )}
                  {canAccess('/stock-value') && (
                    <button
                      onClick={() => handleNavigation('/stock-value')}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                    >
                      <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm">Stock Value</span>
                    </button>
                  )}

                  {canAccess('/defect-management') && (
                    <button
                      onClick={() => handleNavigation('/defect-management')}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                    >
                      <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-sm">Defect & Damage</span>
                    </button>
                  )}
                </>
              )}

            </div>
          </div>

          {/* Finance & Reports (Unified Sales Report & Settlement) */}
          {!isEmployee && (canAccess('/overall-sales') || canAccess('/settlement')) && (
          <div>
            <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Turnover & Reports</h3>
            <div className="space-y-1">
              {(canAccess('/overall-sales') || canAccess('/settlement')) && (
              <button
                onClick={() => handleNavigation('/overall-sales')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
              >
                <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm">Sales Report & Settlement</span>
              </button>
              )}
            </div>
          </div>
          )}

          {/* Administration */}

          {!isEmployee && (canAccess('/employee-management') || canAccess('/users') || canAccess('/add-employee')) && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Administration</h3>
              <div className="space-y-1">

                {canAccess('/employee-management') && (
                <button
                  onClick={() => handleNavigation('/employee-management')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <span className="text-sm">Employees</span>
                </button>
                )}

                {canAccess('/add-employee') && (
                  <button
                    onClick={() => handleNavigation('/add-employee')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                  >
                    <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    <span className="text-sm">Add User</span>
                  </button>
                )}
              </div>
            </div>
          )}


          {/* Settings */}
          {!isEmployee && canAccess('/settings') && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">System</h3>
              <div className="space-y-1">
                <button
                  onClick={() => handleNavigation('/settings')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm">Settings</span>
                </button>
              </div>
            </div>
          )}


          {/* Employee Specific */}
          {isEmployee && (
            <div>
              <h3 className="px-4 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">My Workspace</h3>
              <div className="space-y-1">
                <button
                  onClick={() => handleNavigation('/employee-dashboard')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span className="text-sm">My Attendance</span>
                </button>

                <button
                  onClick={() => handleNavigation('/employee-profile')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:text-blue-600 hover:bg-blue-50 font-medium transition-all duration-200 rounded-xl group"
                >
                  <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="text-sm">My Profile</span>
                </button>
              </div>
            </div>
          )}
        </nav>
      </div>

      {showNavigation && isEmployee && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="flex justify-around items-center py-2">
            <button
              onClick={() => handleNavigation('/stock-requirement')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <span className="text-[10px] font-medium text-center">Stock Req</span>
            </button>

            {canAccess('/service-management') && (
              <button
                onClick={() => handleNavigation('/service-management')}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[10px] font-medium text-center">Services</span>
              </button>
            )}

            {canAccess('/service-management/create') && (
              <button
                onClick={() => handleNavigation('/service-management/create')}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[10px] font-medium text-center">New Job</span>
              </button>
            )}

            <button
              onClick={() => handleNavigation('/employee-dashboard')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="text-[10px] font-medium text-center">Attendance</span>
            </button>

            <button
              onClick={() => handleNavigation('/employee-profile')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-[10px] font-medium text-center">Profile</span>
            </button>
          </div>
        </nav>
      )}

      {showNavigation && !isEmployee && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="flex justify-around items-center py-2">
            {isHubUser && (
              <button
                onClick={() => handleNavigation('/hub-dashboard')}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-indigo-600 active:text-indigo-600 transition-colors duration-200"
              >
                <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span className="text-xs font-medium">Hub</span>
              </button>
            )}
            {canAccess('/dashboard') && (
            <button
              onClick={() => handleNavigation('/dashboard')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="text-xs font-medium">Home</span>
            </button>
            )}

            {canAccess('/billing') && (
            <button
              onClick={() => handleNavigation('/billing')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="text-xs font-medium">Billing</span>
            </button>
            )}

            {canAccess('/overall-sales') && (
            <button
              onClick={() => handleNavigation('/overall-sales')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-medium">Report</span>
            </button>
            )}

            {canAccess('/products') && (
            <button
              onClick={() => handleNavigation('/products')}
              className="flex flex-col items-center justify-center flex-1 py-2 px-1 text-gray-600 hover:text-blue-600 active:text-blue-600 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-xs font-medium">Product</span>
            </button>
            )}
          </div>
        </nav>
      )}
    </>
  );
};

export default Navbar;
