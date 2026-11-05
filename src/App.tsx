
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { StoreProvider } from './context/StoreContext';
import { ToastProvider } from './context/ToastContext';
import { AttendanceProvider } from '@/context/AttendanceContext';
import Login from './components/Login';
import HubDashboard from './pages/HubDashboard';
import Settings from './pages/Settings';
import AddEntry from './pages/AddEntry';
import AddExpense from './pages/AddExpense';
import AddEmployee from './pages/AddEmployee';
import Products from './pages/Products';
import AddProduct from './pages/AddProduct';
import DeleteProductsByBrandCategory from './pages/DeleteProductsByBrandCategory';
import TamperLabel from './pages/TamperLabel';

import OverallSales from './pages/OverallSales';
import Master from './pages/Master';
import Purchases from './pages/Purchases';
import PurchaseDetail from './pages/PurchaseDetail';
import AddPurchase from './pages/AddPurchase';
import AddPurchaseIMEI from './pages/AddPurchaseIMEI';
import Suppliers from './pages/Suppliers';
import SupplierLedger from './pages/SupplierLedger';
import Billing from './pages/Billing';
import QuotationManagement from './pages/QuotationManagement';
import StockRequirement from './pages/StockRequirement';
import StockTransfer from './pages/StockTransfer';
import BranchManagement from './pages/BranchManagement';
import ServiceManagement from './pages/ServiceManagement';
import ServiceJobEntry from './pages/ServiceJobEntry';
import StockValue from './pages/StockValue';
import CustomerManagement from './pages/CustomerManagement';
import CustomerDetails from './pages/CustomerDetails';
import EmployeeManagement from './pages/EmployeeManagement';
import EmployeeProfile from './pages/EmployeeProfile';
import ViewBill from './pages/customer/ViewBill';
import ViewJobSheet from './pages/customer/ViewJobSheet';
import RechargeAccounts from './pages/RechargeAccounts';
import ProviderManagement from './pages/ProviderManagement';
import BulkRecharge from './pages/BulkRecharge';
import RechargeReport from './pages/RechargeReport';
import Migration from './pages/Migration';
import DefectManagement from './pages/DefectManagement';
import SettlementPage from './pages/Settlement';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <AttendanceProvider>
            <StoreProvider>
            <Routes>
              <Route path="/view-bill/*" element={<ViewBill />} />
              <Route path="/view-job/*" element={<ViewJobSheet />} />
              <Route path="/login" element={<Login />} />
              {/* Head Office Hub routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <HubDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hub-dashboard"
                element={
                  <ProtectedRoute>
                    <HubDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/store-management"
                element={
                  <ProtectedRoute>
                    <BranchManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/branches"
                element={
                  <ProtectedRoute>
                    <BranchManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/branch-management"
                element={
                  <ProtectedRoute>
                    <BranchManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/stock-transfer"
                element={
                  <ProtectedRoute>
                    <StockTransfer />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route path="/about" element={<Navigate to="/settings?tab=shop" replace />} />
              <Route path="/users" element={<Navigate to="/settings?tab=users" replace />} />
              <Route
                path="/add-entry"
                element={
                  <ProtectedRoute>
                    <AddEntry />
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
                path="/add-employee"
                element={
                  <ProtectedRoute>
                    <AddEmployee />
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
                path="/tamper-labels"
                element={
                  <ProtectedRoute>
                    <TamperLabel />
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
                path="/overall-sales"
                element={
                  <ProtectedRoute>
                    <OverallSales />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/master"
                element={
                  <ProtectedRoute>
                    <Master />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/purchases/:id"
                element={
                  <ProtectedRoute>
                    <PurchaseDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/purchases"
                element={
                  <ProtectedRoute>
                    <Purchases />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/add-purchase"
                element={
                  <ProtectedRoute>
                    <AddPurchase />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/edit-purchase/:id"
                element={
                  <ProtectedRoute>
                    <AddPurchase />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/add-purchase-imei"
                element={
                  <ProtectedRoute>
                    <AddPurchaseIMEI />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/edit-purchase-imei/:id"
                element={
                  <ProtectedRoute>
                    <AddPurchaseIMEI />
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
                path="/quotations"
                element={
                  <ProtectedRoute>
                    <QuotationManagement />
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
                path="/suppliers"
                element={
                  <ProtectedRoute>
                    <Suppliers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/suppliers/:id"
                element={
                  <ProtectedRoute>
                    <SupplierLedger />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/supplier-ledger/:id"
                element={
                  <ProtectedRoute>
                    <SupplierLedger />
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
                path="/stock-value"
                element={
                  <ProtectedRoute>
                    <StockValue />
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
                path="/employee-dashboard"
                element={<Navigate to="/dashboard" replace />}
              />
              <Route
                path="/employee-management"
                element={
                  <ProtectedRoute>
                    <EmployeeManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/employee-profile"
                element={
                  <ProtectedRoute>
                    <EmployeeProfile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/employee-profile/:employeeId"
                element={
                  <ProtectedRoute>
                    <EmployeeProfile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/recharge-accounts"
                element={
                  <ProtectedRoute>
                    <RechargeAccounts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/provider-management"
                element={
                  <ProtectedRoute>
                    <ProviderManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bulk-recharge"
                element={
                  <ProtectedRoute>
                    <BulkRecharge />
                  </ProtectedRoute>
                }
              />
              <Route path="/recharge-report" element={<ProtectedRoute><RechargeReport /></ProtectedRoute>} />
              <Route path="/migration" element={<ProtectedRoute><Migration /></ProtectedRoute>} />
              <Route path="/defect-management" element={<ProtectedRoute><DefectManagement /></ProtectedRoute>} />
              <Route path="/settlement" element={<ProtectedRoute><SettlementPage /></ProtectedRoute>} />
              <Route path="/sales-report" element={<ProtectedRoute><OverallSales /></ProtectedRoute>} />
              <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
            </StoreProvider>
          </AttendanceProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
