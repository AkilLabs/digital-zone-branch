import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import type { User } from '../types';
import {
  Users,
  Search,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Building2,
  RefreshCw,
} from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Branch Admin',
  'store-admin': 'Branch Admin',
  manager: 'Manager',
  sales_person: 'Sales Person',
  technician: 'Technician',
  cashier: 'Cashier',
  employee: 'Staff',
};

const ROLE_BADGE_STYLES: Record<string, string> = {
  admin: 'bg-blue-50 text-blue-700 border-blue-200',
  'store-admin': 'bg-blue-50 text-blue-700 border-blue-200',
  manager: 'bg-purple-50 text-purple-700 border-purple-200',
  sales_person: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  technician: 'bg-amber-50 text-amber-700 border-amber-200',
  cashier: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  employee: 'bg-slate-100 text-slate-700 border-slate-200',
};

const EmployeeManagement: React.FC = () => {
  const { currentStore } = useStore();
  const [employees, setEmployees] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  useEffect(() => {
    fetchBranchEmployees();
  }, [currentStore?.id]);

  const fetchBranchEmployees = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(collection(db, 'users'));
      const allUsers: User[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          uid: docSnap.id,
          email: data.email || '',
          role: data.role || 'employee',
          displayName: data.name || data.displayName || data.email || 'Staff',
          name: data.name || data.displayName || '',
          phone: data.phone || '',
          address: data.address || '',
          joiningDate: data.joiningDate || '',
          storeId: data.storeId || '',
          storeName: data.storeName || '',
          isActive: data.isActive !== false,
        } as User;
      });

      // Show only branch staff assigned to this branch (exclude owner / hq-admin)
      const branchRoles = [
        'admin',
        'store-admin',
        'manager',
        'sales_person',
        'technician',
        'cashier',
        'employee',
      ];

      const filtered = allUsers.filter((u) => {
        if (!branchRoles.includes(u.role)) return false;
        if (currentStore?.id) {
          return u.storeId === currentStore.id;
        }
        return true;
      });

      filtered.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setEmployees(filtered);
    } catch (error) {
      console.error('Error fetching branch employee list:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (roleFilter !== 'all' && emp.role !== roleFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        (emp.displayName || '').toLowerCase().includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        (emp.phone || '').toLowerCase().includes(q) ||
        (ROLE_LABELS[emp.role] || emp.role).toLowerCase().includes(q)
      );
    });
  }, [employees, roleFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900">
                Branch Employee List
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Staff assigned to{' '}
                <span className="font-semibold text-slate-700">
                  Digital Zone — {currentStore?.name || 'Branch'}
                </span>{' '}
                (Managed from Head Office)
              </p>
            </div>
          </div>

          <button
            onClick={fetchBranchEmployees}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Summary & Filters */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 sm:p-4 mb-5 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branch employees by name, phone, email, or role..."
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {[
              { id: 'all', label: `All (${employees.length})` },
              { id: 'manager', label: 'Manager' },
              { id: 'sales_person', label: 'Sales Person' },
              { id: 'technician', label: 'Technician' },
              { id: 'cashier', label: 'Cashier' },
              { id: 'admin', label: 'Admin' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRoleFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  roleFilter === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Employee Cards / Directory */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
            Loading branch employees...
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">No Branch Employees Found</h3>
            <p className="text-xs text-slate-500 mt-1">
              Employees are created and assigned to this branch from the Head Office portal.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredEmployees.map((emp) => (
              <div
                key={emp.uid}
                className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 font-bold text-sm flex items-center justify-center flex-shrink-0 border border-blue-100">
                        {(emp.displayName || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 truncate">
                          {emp.displayName}
                        </h3>
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {currentStore?.name || emp.storeName || 'Assigned Branch'}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                        ROLE_BADGE_STYLES[emp.role] || ROLE_BADGE_STYLES.employee
                      }`}
                    >
                      {ROLE_LABELS[emp.role] || emp.role}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    {emp.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="tabular-nums">{emp.phone}</span>
                      </div>
                    )}
                    {emp.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="truncate">{emp.email}</span>
                      </div>
                    )}
                    {emp.address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="truncate">{emp.address}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" /> Active Staff
                  </span>
                  {emp.joiningDate && <span>Joined {emp.joiningDate}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default EmployeeManagement;
