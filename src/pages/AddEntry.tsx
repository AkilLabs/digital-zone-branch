import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToastContext } from '../context/ToastContext';
import { useStore } from '../context/StoreContext';
import Navbar from '../components/Navbar';
import BillingForm from '../components/BillingForm';
import ShareModal from '../components/ShareModal';
import type { BillingItem, ShopDetails } from '../types';
import { 
  addDoc, 
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateInvoice } from '../utils/pdfGenerator';

const AddEntry: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { success, error, warning } = useToastContext();
  const { getCollectionRef, getDocRef } = useStore();
  const [lastAddedItem, setLastAddedItem] = useState<BillingItem | null>(null);
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Fetch shop details on mount
  useEffect(() => {
    const fetchShopDetails = async () => {
      try {
        const shopDetailsRef = doc(db, 'settings', 'shopDetails');
        const shopDetailsSnap = await getDoc(shopDetailsRef);
        if (shopDetailsSnap.exists()) {
          setShopDetails(shopDetailsSnap.data() as ShopDetails);
        }
      } catch (error) {
        console.error('Error fetching shop details:', error);
      }
    };
    fetchShopDetails();
  }, []);

  const handleAddItem = async (item: Omit<BillingItem, 'id' | 'createdAt' | 'createdBy' | 'createdByName' | 'updatedAt'>) => {
    try {
      const displayName = currentUser?.displayName || currentUser?.email || 'Unknown User';
      const newItem = {
        ...item,
        createdAt: Timestamp.now(),
        createdBy: displayName,
        createdByName: displayName
      };
      
      // Get entry type (product, service, or credit)
      const itemType = (item as any).type || 'product';
      
      if (itemType === 'product') {
        // Find the product by matching item.title with product.name
        const productQuery = query(
          getCollectionRef('products'), 
          where('name', '==', item.title)
        );
        const productSnapshot = await getDocs(productQuery);
        
        if (!productSnapshot.empty) {
          const productDoc = productSnapshot.docs[0];
          const currentQuantity = productDoc.data().quantity;
          const newQuantity = currentQuantity - item.quantity;
          
          if (currentQuantity < item.quantity) {
            warning(`Insufficient stock! Only ${currentQuantity} units available.`);
            return;
          }
          
          await updateDoc(getDocRef('products', productDoc.id), {
            quantity: newQuantity,
            isAvailable: newQuantity > 0,
            updatedAt: new Date()
          });
        } else {
          // If product not found by name, try by product code
          const productCodeQuery = query(
            getCollectionRef('products'), 
            where('productCode', '==', item.title)
          );
          const productCodeSnapshot = await getDocs(productCodeQuery);
          
          if (!productCodeSnapshot.empty) {
            const productDoc = productCodeSnapshot.docs[0];
            const currentQuantity = productDoc.data().quantity;
            const newQuantity = currentQuantity - item.quantity;
            
            if (currentQuantity < item.quantity) {
              warning(`Insufficient stock! Only ${currentQuantity} units available.`);
              return;
            }
            
            await updateDoc(getDocRef('products', productDoc.id), {
              quantity: newQuantity,
              isAvailable: newQuantity > 0,
              updatedAt: new Date()
            });
          }
          // If product not found in inventory, continue with sale (manual entry)
        }
      }
      
      // Choose collection based on entry type
      const collectionName = itemType === 'credit' ? 'creditSales' : 'billingItems';
      
      // Add the sale to appropriate collection
      const docRef = await addDoc(getCollectionRef(collectionName), newItem);
      
      // Store the item with its ID for invoice generation
      const itemWithId = {
        ...newItem,
        id: docRef.id,
        createdAt: new Date()
      } as BillingItem;
      
      setLastAddedItem(itemWithId);
      const entryTypeLabel = itemType === 'credit' ? 'Credit Sale' : (itemType === 'service' ? 'Service' : 'Sale');
      success(`${entryTypeLabel} added successfully!`);
    } catch (err: any) {
      console.error('Error adding sale:', err);
      error(`Failed to add sale: ${err?.message || 'Unknown error'}. Please check the console for details.`);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!lastAddedItem) {
      warning('Please add a sale first!');
      return;
    }

    const defaultShopDetails: ShopDetails = {
      shopName: 'Your Shop Name',
      ownerName: 'Owner',
      address: 'Shop Address',
      phone: '1234567890',
      email: 'shop@example.com',
      gst: ''
    };

    await generateInvoice(lastAddedItem, shopDetails || defaultShopDetails);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w mx-auto px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-6">
        <BillingForm
          onSubmit={handleAddItem}
          isEdit={false}
        />

        {/* Action Buttons - Show after adding an item */}
        {lastAddedItem && (
          <div className="mt-6 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Invoice Actions</h3>
            <p className="text-sm text-gray-600 mb-4">
              Sale added successfully! You can now download or share the invoice.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Download Invoice Button */}
              <button
                onClick={handleDownloadInvoice}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Invoice
              </button>

              {/* Share Invoice Button */}
              <button
                onClick={() => setIsShareModalOpen(true)}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                </svg>
                Share Invoice
              </button>

              {/* Back to Dashboard Button */}
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-500 text-white rounded-lg font-semibold hover:bg-gray-600 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Back to Dashboard
              </button>
            </div>

            {/* Item Summary */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Sale Summary</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Item:</span>
                  <span className="ml-2 font-medium">{lastAddedItem.title}</span>
                </div>
                <div>
                  <span className="text-gray-600">Quantity:</span>
                  <span className="ml-2 font-medium">{lastAddedItem.quantity}</span>
                </div>
                <div>
                  <span className="text-gray-600">Price per unit:</span>
                  <span className="ml-2 font-medium">Rs. {lastAddedItem.sellingPrice.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-600">Total:</span>
                  <span className="ml-2 font-semibold text-green-600">
                    Rs. {(lastAddedItem.sellingPrice * lastAddedItem.quantity).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Share Modal */}
        {lastAddedItem && shopDetails && (
          <ShareModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            item={lastAddedItem}
            shopDetails={shopDetails}
          />
        )}
      </main>
    </div>
  );
};

export default AddEntry;
