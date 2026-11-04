import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { StoreProvider, useStore } from './context/StoreContext';
import { ToastProvider } from './context/ToastContext';
import { AttendanceProvider } from '@/context/AttendanceContext';
import Login from './components/Login';
import Dashboard from './pages/Dashboard';
import AddExpense from './pages/AddExpense';
import Products from './pages/Products';
import AddProduct from './pages/AddProduct';
import DeleteProductsByBrandCategory from './pages/DeleteProductsByBrandCategory';
import OverallSales from './pages/OverallSales';
import Master from './pages/Master';
import Purchases from './pages/Purchases';
import PurchaseDetail from './pages/PurchaseDetail';
import AddPurchase from './pages/AddPurchase';
import AddPurchaseIMEI from './pages/AddPurchaseIMEI';
import Billing from './pages/Billing';
import StockRequirement from './pages/StockRequirement';
import ServiceManagement from './pages/ServiceManagement';
import ServiceJobEntry from './pages/ServiceJobEntry';
import CustomerManagement from './pages/CustomerManagement';
import CustomerDetails from './pages/CustomerDetails';
import EmployeeManagement from './pages/EmployeeManagement';
import ViewBill from './pages/customer/ViewBill';
import ViewJobSheet from './pages/customer/ViewJobSheet';
import DefectManagement from './pages/DefectManagement';
import SettlementPage from './pages/Settlement';
import StockReceived from './pages/StockReceived';
import BranchStockTransfer from './pages/BranchStockTransfer';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

/**
 * Guards optional Branch Purchase routes so they are accessible only
 * when Branch Purchase is enabled for the current branch in HQ.
 */
const PurchaseFeatureGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentStore, loading } = useStore();
  if (loading) return null;
  if (!currentStore?.purchaseEnabled) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <AttendanceProvider>
            <StoreProvider>
              <Routes>
                {/* Public Customer Invoice / Job Sheet View */}
                <Route path="/view-bill/*" element={<ViewBill />} />
                <Route path="/view-job/*" element={<ViewJobSheet />} />
                <Route path="/login" element={<Login />} />

                {/* Mandatory Branch Routes */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/billing"
                  element={
                    <ProtectedRoute>
                      <Billing />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/billing/edit/*"
                  element={
                    <ProtectedRoute>
                      <Billing />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/add-expense"
                  element={
                    <ProtectedRoute>
                      <AddExpense />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/customers"
                  element={
                    <ProtectedRoute>
                      <CustomerManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/customers/:id"
                  element={
                    <ProtectedRoute>
                      <CustomerDetails />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/products"
                  element={
                    <ProtectedRoute>
                      <Products />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/add-product"
                  element={
                    <ProtectedRoute>
                      <AddProduct />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/delete-products-by-brand-category"
                  element={
                    <ProtectedRoute>
                      <DeleteProductsByBrandCategory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/bulk-delete-products"
                  element={
                    <ProtectedRoute>
                      <DeleteProductsByBrandCategory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/stock-received"
                  element={
                    <ProtectedRoute>
                      <StockReceived />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/stock-transfer"
                  element={
                    <ProtectedRoute>
                      <BranchStockTransfer />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/stock-requirement"
                  element={
                    <ProtectedRoute>
                      <StockRequirement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/defect-management"
                  element={
                    <ProtectedRoute>
                      <DefectManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/service-management"
                  element={
                    <ProtectedRoute>
                      <ServiceManagement />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/service-management/create"
                  element={
                    <ProtectedRoute>
                      <ServiceJobEntry />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/overall-sales"
                  element={
                    <ProtectedRoute>
                      <OverallSales />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/sales-report"
                  element={
                    <ProtectedRoute>
                      <OverallSales />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settlement"
                  element={
                    <ProtectedRoute>
                      <SettlementPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/employee-management"
                  element={
                    <ProtectedRoute>
                      <EmployeeManagement />
                    </ProtectedRoute>
                  }
                />

                {/* Optional Branch Purchase Routes (Active only when purchaseEnabled === true) */}
                <Route
                  path="/purchases"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <Purchases />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/purchases/:id"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <PurchaseDetail />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/add-purchase"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <AddPurchase />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/edit-purchase/:id"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <AddPurchase />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/add-purchase-imei"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <AddPurchaseIMEI />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/edit-purchase-imei/:id"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <AddPurchaseIMEI />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />
                {/* Branch does not manage external suppliers — redirect to dashboard */}
                <Route
                  path="/suppliers"
                  element={<Navigate to="/dashboard" replace />}
                />
                <Route
                  path="/master"
                  element={
                    <ProtectedRoute>
                      <PurchaseFeatureGuard>
                        <Master />
                      </PurchaseFeatureGuard>
                    </ProtectedRoute>
                  }
                />

                {/* RedirectHQ-only or removed routes to Branch Home */}
                <Route path="/quotations" element={<Navigate to="/dashboard" replace />} />
                <Route path="/add-employee" element={<Navigate to="/dashboard" replace />} />
                <Route path="/employee-dashboard" element={<Navigate to="/dashboard" replace />} />
                <Route path="/hub-dashboard" element={<Navigate to="/dashboard" replace />} />
                <Route path="/store-management" element={<Navigate to="/dashboard" replace />} />
                <Route path="/" element={<Navigate to="/login" replace />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </StoreProvider>
          </AttendanceProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
