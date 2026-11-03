import React, { useState } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { generateProductCode, generateIMEIProductCode } from '../utils/productCode';
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

/**
 * This component is used to migrate existing products to add product codes
 * Run this once after deployment, then it can be removed
 */
const ProductCodeMigration: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);

  const runMigration = async () => {
    setStatus('running');
    setMessage('Starting migration...');
    setProcessed(0);
    setTotal(0);

    try {
      // Get all products
      const productsSnapshot = await getDocs(collection(db, 'products'));
      const products = productsSnapshot.docs;
      setTotal(products.length);

      if (products.length === 0) {
        setMessage('No products found to migrate');
        setStatus('success');
        return;
      }

      let updated = 0;
      let skipped = 0;
      let nextProductCodeNumber: number | null = null;

      for (const productDoc of products) {
        const productData = productDoc.data();
        
        // Skip if already has product code
        if (productData.productCode) {
          skipped++;
          setProcessed(prev => prev + 1);
          continue;
        }

        // Generate and update product code
        if (productData.imei && String(productData.imei).trim()) {
          const imeiCode = await generateIMEIProductCode();
          await updateDoc(doc(db, 'products', productDoc.id), {
            productCode: imeiCode
          });
        } else {
          if (nextProductCodeNumber === null) {
            const nextCode = await generateProductCode();
            nextProductCodeNumber = parseInt(nextCode, 10);
          }

          const productCode = String(nextProductCodeNumber).padStart(8, '0');
          nextProductCodeNumber += 1;
          await updateDoc(doc(db, 'products', productDoc.id), {
            productCode: productCode
          });
        }

        updated++;
        setProcessed(prev => prev + 1);
      }

      setMessage(`Migration completed! Updated: ${updated}, Skipped: ${skipped}`);
      setStatus('success');
    } catch (error) {
      console.error('Migration error:', error);
      setMessage('Error during migration: ' + (error as Error).message);
      setStatus('error');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border-2 border-orange-200">
      <div className="flex items-center gap-3 mb-4">
        <AlertCircle className="h-6 w-6 text-orange-600" />
        <h3 className="text-lg font-bold text-gray-900">Product Code Migration</h3>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        This tool will add unique 8-digit product codes to all existing products that don't have one.
        Run this once after deployment. Products added after this will automatically get codes.
      </p>

      {status === 'idle' && (
        <button
          onClick={runMigration}
          className="w-full bg-orange-600 text-white py-3 px-4 rounded-lg hover:bg-orange-700 transition-colors font-medium flex items-center justify-center gap-2"
        >
          <RefreshCw className="h-5 w-5" />
          Run Migration
        </button>
      )}

      {status === 'running' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-blue-600">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            <span className="font-medium">Migrating products...</span>
          </div>
          <div className="text-sm text-gray-600">
            Progress: {processed} / {total}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${total > 0 ? (processed / total) * 100 : 0}%` }}
            ></div>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900">Success!</p>
            <p className="text-sm text-green-700">{message}</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <div>
            <p className="font-medium text-red-900">Error</p>
            <p className="text-sm text-red-700">{message}</p>
          </div>
        </div>
      )}

      {(status === 'success' || status === 'error') && (
        <button
          onClick={() => setStatus('idle')}
          className="mt-4 w-full bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors font-medium"
        >
          Reset
        </button>
      )}
    </div>
  );
};

export default ProductCodeMigration;
