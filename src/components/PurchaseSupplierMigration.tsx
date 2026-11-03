import React, { useState } from 'react';
import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useToast } from '../hooks/useToast';
import type { Purchase, Supplier } from '../types';

const PurchaseSupplierMigration: React.FC = () => {
  const { showToast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState({
    total: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  });

  const runMigration = async () => {
    setIsRunning(true);
    setProgress('Starting migration...');
    
    const newStats = { total: 0, updated: 0, skipped: 0, errors: 0 };

    try {
      // Fetch all purchases
      const purchasesRef = collection(db, 'purchases');
      const snapshot = await getDocs(purchasesRef);
      newStats.total = snapshot.docs.length;
      
      setProgress(`Found ${newStats.total} purchases. Checking for missing supplier names...`);

      for (const purchaseDoc of snapshot.docs) {
        const purchase = purchaseDoc.data() as Purchase;
        
        // Check if supplierName is missing or empty
        if (!purchase.supplierName && purchase.supplierId) {
          try {
            // Fetch supplier details
            const supplierDoc = await getDoc(doc(db, 'suppliers', purchase.supplierId));
            
            if (supplierDoc.exists()) {
              const supplier = supplierDoc.data() as Supplier;
              
              // Update purchase with supplier name
              await updateDoc(doc(db, 'purchases', purchaseDoc.id), {
                supplierName: supplier.name
              });
              
              newStats.updated++;
              setProgress(`Updated purchase ${purchase.purchaseNumber} with supplier: ${supplier.name}`);
            } else {
              newStats.errors++;
              setProgress(`Supplier not found for purchase ${purchase.purchaseNumber}`);
            }
          } catch (error) {
            newStats.errors++;
            console.error(`Error updating purchase ${purchase.purchaseNumber}:`, error);
          }
        } else {
          newStats.skipped++;
        }
        
        setStats({ ...newStats });
      }

      setProgress('Migration completed!');
      showToast(`Migration completed: ${newStats.updated} updated, ${newStats.skipped} skipped, ${newStats.errors} errors`, 'success');
    } catch (error) {
      console.error('Migration error:', error);
      showToast('Migration failed', 'error');
      setProgress('Migration failed. Check console for details.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Purchase Supplier Name Migration
      </h2>
      
      <div className="mb-4">
        <p className="text-sm text-gray-600 mb-2">
          This tool will update all purchases that are missing supplier names by fetching the supplier details from the database.
        </p>
        <p className="text-sm text-orange-600">
          <strong>Note:</strong> This is a one-time migration. Run this only if you have purchases without supplier names.
        </p>
      </div>

      {stats.total > 0 && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Total</p>
              <p className="text-lg font-semibold text-gray-900">{stats.total}</p>
            </div>
            <div>
              <p className="text-gray-600">Updated</p>
              <p className="text-lg font-semibold text-green-600">{stats.updated}</p>
            </div>
            <div>
              <p className="text-gray-600">Skipped</p>
              <p className="text-lg font-semibold text-gray-600">{stats.skipped}</p>
            </div>
            <div>
              <p className="text-gray-600">Errors</p>
              <p className="text-lg font-semibold text-red-600">{stats.errors}</p>
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <p className="text-sm text-gray-700 font-mono">{progress}</p>
        </div>
      )}

      <button
        onClick={runMigration}
        disabled={isRunning}
        className={`px-6 py-2.5 rounded-lg font-medium transition-colors ${
          isRunning
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isRunning ? 'Running Migration...' : 'Run Migration'}
      </button>
    </div>
  );
};

export default PurchaseSupplierMigration;
