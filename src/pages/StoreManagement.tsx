import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import { collection, addDoc, updateDoc, doc, Timestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Store } from '../types';

const StoreManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentHub, stores, refreshStores } = useStore();
  const navigate = useNavigate();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    gst: '',
    upiId: '',
    merchantName: '',
  });

  const resetForm = () => {
    setFormData({ name: '', address: '', phone: '', email: '', gst: '', upiId: '', merchantName: '' });
  };

  const handleFormChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddStore = async () => {
    if (!formData.name.trim() || !currentUser?.uid) return;

    setLoading(true);
    try {
      if (!currentHub?.id) {
        // First-time setup: create hub metadata doc (hubs/{hubId})
        const hubRef = doc(collection(db, 'hubs'));
        await setDoc(hubRef, {
          name: 'My Hub',
          ownerName: currentUser.displayName || currentUser.email || 'Admin',
          isActive: true,
          createdAt: Timestamp.now(),
          createdBy: currentUser.uid,
        });

        // Create the store as a flat document: stores/{storeId}
        const storeRef = doc(collection(db, 'stores'));
        await setDoc(storeRef, {
          hubId: hubRef.id,          // links back to the hub
          name: formData.name.trim(),
          address: formData.address.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          gst: formData.gst.trim(),
          upiId: formData.upiId.trim(),
          merchantName: formData.merchantName.trim(),
          isActive: true,
          createdAt: Timestamp.now(),
          createdBy: currentUser.uid,
          updatedAt: Timestamp.now(),
        });

        // Assign hub + store to the owner user
        const userRef = doc(db, 'users', currentUser.uid);
        await setDoc(userRef, { hubId: hubRef.id, storeId: storeRef.id, role: 'owner', scope: 'hub' }, { merge: true });

        // Reload so StoreContext re-initialises with the new hubId / storeId
        window.location.reload();
        return;
      }

      // Hub already exists – add another store: stores/{newId}
      await addDoc(collection(db, 'stores'), {
        hubId: currentHub.id,
        name: formData.name.trim(),
        address: formData.address.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        gst: formData.gst.trim(),
        upiId: formData.upiId.trim(),
        merchantName: formData.merchantName.trim(),
        isActive: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser.uid,
        updatedAt: Timestamp.now(),
      });

      await refreshStores();
      setShowAddModal(false);
      resetForm();
    } catch (error) {
      console.error('Error adding store:', error);
      alert('Failed to add store. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditStore = (store: Store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      address: store.address || '',
      phone: store.phone || '',
      email: store.email || '',
      gst: store.gst || '',
      upiId: store.upiId || '',
      merchantName: store.merchantName || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!formData.name.trim() || !editingStore?.id) return;

    setLoading(true);
    try {
      // stores/{storeId} — flat path
      const storeRef = doc(db, 'stores', editingStore.id);
      await updateDoc(storeRef, {
        name: formData.name.trim(),
        address: formData.address.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        gst: formData.gst.trim(),
        upiId: formData.upiId.trim(),
        merchantName: formData.merchantName.trim(),
        updatedAt: Timestamp.now(),
      });

      await refreshStores();
      setShowEditModal(false);
      setEditingStore(null);
      resetForm();
    } catch (error) {
      console.error('Error updating store:', error);
      alert('Failed to update store. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (store: Store) => {
    if (!store.id) return;

    try {
      // stores/{storeId} — flat path
      const storeRef = doc(db, 'stores', store.id);
      await updateDoc(storeRef, {
        isActive: !store.isActive,
        updatedAt: Timestamp.now(),
      });
      await refreshStores();
    } catch (error) {
      console.error('Error toggling store status:', error);
    }
  };

  const renderFormModal = (isEdit: boolean) => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={() => { isEdit ? setShowEditModal(false) : setShowAddModal(false); resetForm(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Store' : 'Add New Store'}</h2>
          <p className="text-sm text-gray-500 mt-1">{isEdit ? 'Update store details' : 'Create a new store under your hub'}</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => handleFormChange('name', e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              placeholder="e.g., Main Branch"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={e => handleFormChange('address', e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              placeholder="Store address"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={e => handleFormChange('phone', e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                placeholder="Phone number"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => handleFormChange('email', e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                placeholder="Email address"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">GST Number</label>
              <input
                type="text"
                value={formData.gst}
                onChange={e => handleFormChange('gst', e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                placeholder="GST Number"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID</label>
              <input
                type="text"
                value={formData.upiId}
                onChange={e => handleFormChange('upiId', e.target.value)}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                placeholder="UPI ID for payments"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Merchant Name (UPI)</label>
            <input
              type="text"
              value={formData.merchantName}
              onChange={e => handleFormChange('merchantName', e.target.value)}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              placeholder="Merchant display name"
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex gap-3">
          <button
            onClick={() => { isEdit ? setShowEditModal(false) : setShowAddModal(false); resetForm(); }}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={isEdit ? handleSaveEdit : handleAddStore}
            disabled={loading || !formData.name.trim()}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Store'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 font-sans">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-16 md:mt-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Store Management</h1>
            <p className="text-sm text-gray-500 mt-1">{currentHub?.name} • {stores.length} store{stores.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => { resetForm(); setShowAddModal(true); }}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all shadow-sm flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Store
          </button>
        </div>

        {/* Store List */}
        <div className="space-y-4">
          {stores.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No stores yet</h3>
              <p className="text-gray-500 mb-4">Create your first store to get started</p>
              <button
                onClick={() => { resetForm(); setShowAddModal(true); }}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Create First Store
              </button>
            </div>
          ) : (
            stores.map((store) => (
              <div key={store.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-blue-200 transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">{store.name}</h3>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${store.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {store.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {store.address && <p className="text-sm text-gray-500 mt-1">{store.address}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        {store.phone && <span>📞 {store.phone}</span>}
                        {store.email && <span>📧 {store.email}</span>}
                        {store.gst && <span>GST: {store.gst}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditStore(store)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      title="Edit store"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleToggleActive(store)}
                      className={`p-2 rounded-lg transition-all ${store.isActive ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                      title={store.isActive ? 'Deactivate store' : 'Activate store'}
                    >
                      {store.isActive ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Back button */}
        <div className="mt-6">
          <button
            onClick={() => navigate('/hub-dashboard')}
            className="text-sm text-gray-500 hover:text-blue-600 font-medium flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Hub Dashboard
          </button>
        </div>
      </div>

      {/* Modals */}
      {showAddModal && renderFormModal(false)}
      {showEditModal && renderFormModal(true)}
    </div>
  );
};

export default StoreManagement;
