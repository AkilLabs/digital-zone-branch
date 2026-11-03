import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { BillingItem, ShopDetails } from '../types';
import { generateInvoice, generateInvoiceForWhatsApp } from '../utils/pdfGenerator';
import { useToastContext } from '../context/ToastContext';
import { User, Share2, Mail, Copy, Check } from 'lucide-react';
import Lottie from 'lottie-react';
import SuccessAnim from '../assets/Success.json';
import EmailSentAnim from '../assets/EmailSent.json';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: BillingItem;
  shopDetails: ShopDetails;
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  initialCustomerEmail?: string;
  shareType?: 'whatsapp' | 'email'; // New prop to determine share type
}

const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  item,
  shopDetails,
  initialCustomerName = '',
  initialCustomerPhone = '',
  initialCustomerEmail = '',
  shareType = 'whatsapp' // Default to WhatsApp for backward compatibility
}) => {
  const { success, error: showError } = useToastContext();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [showEmailSuccess, setShowEmailSuccess] = useState(false);

  // Customer Autocomplete State
  const [customers, setCustomers] = useState<any[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Pre-fill customer details
  useEffect(() => {
    if (isOpen) {
      if (item?.customerName && item.customerName !== 'Walk In Customer') {
        const parts = item.customerName.split(' • ');
        setCustomerName(parts[0] || initialCustomerName);
        setCustomerPhone(parts.length >= 2 ? parts[1] : (item.customerPhone || initialCustomerPhone));
      } else {
        setCustomerName(initialCustomerName);
        setCustomerPhone(initialCustomerPhone);
      }
      // Set email from item or initial
      setCustomerEmail(item?.customerEmail || initialCustomerEmail);
    }
  }, [isOpen, item, initialCustomerName, initialCustomerPhone, initialCustomerEmail]);

  // Fetch customers for autocomplete
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const q = query(collection(db, 'customers'), orderBy('createdAt', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCustomers(list);
      } catch (error) {
        console.error("Error fetching customers:", error);
      }
    };
    if (isOpen) fetchCustomers();
  }, [isOpen]);

  // Filter customers based on input
  useEffect(() => {
    if (!customerName && !customerPhone) {
      setFilteredCustomers([]);
      return;
    }
    const lowerName = customerName.toLowerCase();
    const lowerPhone = customerPhone.toLowerCase();

    const matches = customers.filter(c =>
      (c.name && c.name.toLowerCase().includes(lowerName) && lowerName.length > 1) ||
      (c.phone && c.phone.includes(lowerPhone) && lowerPhone.length > 2)
    ).slice(0, 5);

    setFilteredCustomers(matches);
    setShowSuggestions(matches.length > 0 && (!!customerName || !!customerPhone));
  }, [customerName, customerPhone, customers]);

  // Helper to close suggestions on click outside
  useEffect(() => {
    if (!isOpen) return; // Only add listener when modal is open

    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Android WebView bridge detection
  const isAndroidWebView = () => typeof window !== 'undefined' && (window as any).AndroidInterface;

  // Early return after all hooks
  if (!isOpen || !item) return null;

  const selectCustomer = (c: any) => {
    setCustomerName(c.name || '');
    setCustomerPhone(c.phone || '');
    setCustomerEmail(c.email || '');
    setShowSuggestions(false);
  };

  // Handle Email Send
  const handleEmailSend = async () => {
    if (!customerName.trim()) {
      showError('Please enter customer name');
      return;
    }
    if (!customerEmail.trim()) {
      showError('Please enter customer email');
      return;
    }

    setIsSharing(true);
    try {
      // Import the email sending function from Billing
      const { functions } = await import('../config/firebase');
      const { httpsCallable } = await import('firebase/functions');
      const { generateInvoice } = await import('../utils/pdfGenerator');

      // Generate PDF
      const result = await generateInvoice(item, shopDetails, undefined, true) as any;
      if (!result || !result.pdfData) {
        showError('Failed to generate invoice');
        setIsSharing(false);
        return;
      }

      // Call Firebase Cloud Function to send email
      const sendEmailFunction = httpsCallable(functions, 'sendInvoiceEmail');
      await sendEmailFunction({
        recipientEmail: customerEmail,
        recipientName: customerName,
        pdfBase64: result.pdfData.split(',')[1],
        fileName: result.fileName,
        invoiceData: {
          invoiceNumber: item.transactionId || item.id || String(Date.now()),
          customerName: customerName,
          totalAmount: item.totalWithGst || (item.sellingPrice * item.quantity),
          shopName: shopDetails?.shopName || 'Digital Zone'
        }
      });

      // Save/update customer email in Firestore
      try {
        const customersRef = collection(db, 'customers');
        const q = query(customersRef, where('phone', '==', customerPhone), limit(1));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          // Update existing customer
          const customerDoc = snapshot.docs[0];
          await updateDoc(customerDoc.ref, {
            email: customerEmail,
            updatedAt: Timestamp.now()
          });
        } else if (customerPhone.trim()) {
          // Create new customer
          await addDoc(customersRef, {
            name: customerName,
            phone: customerPhone,
            email: customerEmail,
            createdAt: Timestamp.now()
          });
        }
      } catch (dbError) {
        console.error('Error saving customer:', dbError);
      }

      // Update billing item with customer details
      try {
        console.log('Attempting to update billing item with customer details:', {
          itemId: item.id,
          transactionId: item.transactionId,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim()
        });

        // Determine the collection name based on item type
        const collectionName = (item as any).type === 'credit' ? 'creditSales' : 'billingItems';
        console.log('Using collection:', collectionName);

        // If item has a transactionId, update all items in that transaction
        if (item.transactionId) {
          console.log('Item has transactionId, updating all items in transaction...');
          const q = query(
            collection(db, collectionName),
            where('transactionId', '==', item.transactionId)
          );
          const snapshot = await getDocs(q);

          const updatePromises = snapshot.docs.map(docSnap =>
            updateDoc(docSnap.ref, {
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              customerEmail: customerEmail.trim(),
              updatedAt: Timestamp.now()
            })
          );

          await Promise.all(updatePromises);
          console.log(`Updated ${snapshot.docs.length} items in transaction ${item.transactionId}`);
        } else if (item.id) {
          // Single item update
          console.log('Updating single item with id:', item.id);
          const billingItemDocRef = doc(db, collectionName, item.id);

          await updateDoc(billingItemDocRef, {
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            customerEmail: customerEmail.trim(),
            updatedAt: Timestamp.now()
          });
          console.log('Successfully updated billing item with customer details');
        } else {
          console.warn('No item.id or item.transactionId found, skipping update');
        }
      } catch (updateError) {
        console.error('Error updating billing item:', updateError);
        console.error('Error details:', updateError);
      }


      setShowEmailSuccess(true);
      setTimeout(() => {
        setShowEmailSuccess(false);
        onClose();
      }, 3000);
    } catch (error: any) {
      console.error('Email send error:', error);
      showError(error.message || 'Failed to send email');
    } finally {
      setIsSharing(false);
    }
  };

  const handleWhatsAppShare = async () => {
    if (!customerName.trim()) {
      showError('Please enter customer name');
      return;
    }
    if (!customerPhone.trim()) {
      showError('Please enter customer phone number');
      return;
    }

    setIsSharing(true);
    try {
      // Save/Update Customer Logic
      try {
        const customersRef = collection(db, 'customers');
        // Check by phone
        const q = query(customersRef, where('phone', '==', customerPhone.trim()));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          // New Customer
          await addDoc(customersRef, {
            name: customerName.trim(),
            phone: customerPhone.trim(),
            email: '',
            createdAt: Timestamp.now(),
            createdBy: 'System (Billing Share)',
          });
          console.log('New customer saved');
        }
      } catch (saveError) {
        console.error('Error saving customer info:', saveError);
      }

      // Update billing item with customer details
      try {
        console.log('Attempting to update billing item with customer details (WhatsApp):', {
          itemId: item.id,
          transactionId: item.transactionId,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim()
        });

        // Determine the collection name based on item type
        const collectionName = (item as any).type === 'credit' ? 'creditSales' : 'billingItems';
        console.log('Using collection:', collectionName);

        // If item has a transactionId, update all items in that transaction
        if (item.transactionId) {
          console.log('Item has transactionId, updating all items in transaction...');
          const q = query(
            collection(db, collectionName),
            where('transactionId', '==', item.transactionId)
          );
          const snapshot = await getDocs(q);

          const updatePromises = snapshot.docs.map(docSnap =>
            updateDoc(docSnap.ref, {
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              updatedAt: Timestamp.now()
            })
          );

          await Promise.all(updatePromises);
          console.log(`Updated ${snapshot.docs.length} items in transaction ${item.transactionId}`);
        } else if (item.id) {
          // Single item update
          console.log('Updating single item with id:', item.id);
          const billingItemDocRef = doc(db, collectionName, item.id);

          await updateDoc(billingItemDocRef, {
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            updatedAt: Timestamp.now()
          });
          console.log('Successfully updated billing item with customer details');
        } else {
          console.warn('No item.id or item.transactionId found, skipping update');
        }

        // Also sync customer details into root transactions doc
        const txDocId = (item.transactionId || item.id || '').replace(/\//g, '_');
        if (txDocId) {
          try {
            await updateDoc(doc(db, 'transactions', txDocId), {
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              updatedAt: Timestamp.now()
            });
          } catch {
            // Document might be newly created or store-scoped
          }
        }
      } catch (updateError) {
        console.error('Error updating billing item:', updateError);
        console.error('Error details:', updateError);
      }

      // Generate Link or PDF
      const billId = item.transactionId || item.id;

      let whatsappUrl = '';

      if (billId) {
        // Link Method
        const safeId = (billId || '').replace(/\//g, '_');
        const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
        const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';
        const billUrl = `https://the-legend-mobiles.vercel.app/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;
        const messageText =
          `Hi ${customerName}! 👋\n\n` +
          `Thank you for shopping at ${shopDetails.shopName || 'Digital Zone'}! 🛍️\n\n` +
          `You can download your invoice here:\n` +
          `${billUrl}\n\n` +
          `Thank you for your business! 🙏`;

        let formattedPhone = customerPhone.replace(/\D/g, '');
        if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
        else if (formattedPhone.startsWith('0')) formattedPhone = '91' + formattedPhone.substring(1);

        whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`;
      } else {
        // PDF Method (Fallback)
        const itemWithCustomer: BillingItem = {
          ...item,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim()
        };
        const invoiceNumber = String(Date.now());
        const pdfResult = await generateInvoiceForWhatsApp(itemWithCustomer, shopDetails, invoiceNumber);

        if (pdfResult) {
          const total = (item as any).grandTotal || item.totalWithGst || (item.sellingPrice * item.quantity);
          const messageText = `Hi ${customerName}! Invoice: ${invoiceNumber}. Total: ₹${total}. Thank you!`;
          let formattedPhone = customerPhone.replace(/\D/g, '');
          if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
          whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`;
        }
      }

      console.log('Opening WhatsApp:', whatsappUrl);
      if (whatsappUrl) {
        if (isAndroidWebView()) {
          window.location.href = whatsappUrl;
        } else {
          window.open(whatsappUrl, '_blank');
        }
        success('WhatsApp opened!');
        onClose();
      }

    } catch (error) {
      console.error('Error sharing:', error);
      showError('Failed to share.');
    } finally {
      setIsSharing(false);
    }
  };

  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyLink = async () => {
    const billId = item.transactionId || item.id;
    const safeId = (billId || '').replace(/\//g, '_');
    const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
    const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';
    const billUrl = `https://the-legend-mobiles.vercel.app/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;
    try {
      await navigator.clipboard.writeText(billUrl);
      setCopiedLink(true);
      success('Invoice link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showError('Failed to copy link');
    }
  };

  // Universal Native Device Share (replaces WhatsApp-only)
  const handleUniversalShare = async () => {
    if (!customerName.trim()) {
      showError('Please enter customer name');
      return;
    }

    setIsSharing(true);
    try {
      // 1. Save or update customer in Firestore
      try {
        const customersRef = collection(db, 'customers');
        if (customerPhone.trim()) {
          const q = query(customersRef, where('phone', '==', customerPhone.trim()));
          const querySnapshot = await getDocs(q);

          if (querySnapshot.empty) {
            await addDoc(customersRef, {
              name: customerName.trim(),
              phone: customerPhone.trim(),
              email: customerEmail.trim() || '',
              createdAt: Timestamp.now(),
              createdBy: 'System (Billing Share)',
            });
          } else {
            const customerDoc = querySnapshot.docs[0];
            await updateDoc(customerDoc.ref, {
              name: customerName.trim(),
              email: customerEmail.trim() || customerDoc.data().email || '',
              updatedAt: Timestamp.now()
            });
          }
        }
      } catch (saveError) {
        console.error('Error saving customer info:', saveError);
      }

      // 2. Update billing items / credit sales
      try {
        const collectionName = (item as any).type === 'credit' ? 'creditSales' : 'billingItems';
        if (item.transactionId) {
          const q = query(collection(db, collectionName), where('transactionId', '==', item.transactionId));
          const snapshot = await getDocs(q);
          const updatePromises = snapshot.docs.map(docSnap =>
            updateDoc(docSnap.ref, {
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              customerEmail: customerEmail.trim(),
              updatedAt: Timestamp.now()
            })
          );
          await Promise.all(updatePromises);
        } else if (item.id) {
          const billingItemDocRef = doc(db, collectionName, item.id);
          await updateDoc(billingItemDocRef, {
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            customerEmail: customerEmail.trim(),
            updatedAt: Timestamp.now()
          });
        }

        const txDocId = (item.transactionId || item.id || '').replace(/\//g, '_');
        if (txDocId) {
          try {
            await updateDoc(doc(db, 'transactions', txDocId), {
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              updatedAt: Timestamp.now()
            });
          } catch {
            // Document might be newly created or store-scoped
          }
        }
      } catch (updateError) {
        console.error('Error updating billing item:', updateError);
      }

      // 3. Prepare bill URL and share text
      const billId = item.transactionId || item.id;
      const safeId = (billId || '').replace(/\//g, '_');
      const rawPhoneDigits = customerPhone.replace(/\D/g, '').slice(-10);
      const phoneParam = rawPhoneDigits ? `?p=${encodeURIComponent(rawPhoneDigits)}` : '';
      const billUrl = `https://the-legend-mobiles.vercel.app/view-bill/${encodeURIComponent(safeId)}${phoneParam}`;
      const totalAmount = Math.round(item.totalWithGst || (item.sellingPrice * item.quantity)).toLocaleString('en-IN');
      const shareTitle = `Invoice - ${item.transactionId || safeId}`;
      const shareText = `Hi ${customerName}! 👋\nThank you for shopping at ${shopDetails.shopName || 'The Legend Mobiles'}!\nTotal: ₹${totalAmount}\nYou can view & download your bill here:\n${billUrl}`;

      // 4. Generate PDF
      const itemWithCustomer: BillingItem = {
        ...item,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim()
      };
      const result = await generateInvoice(itemWithCustomer, shopDetails, item.transactionId, true) as any;

      // Check Android WebView bridge first
      if (isAndroidWebView() && (window as any).AndroidInterface?.sharePDF && result?.pdfData) {
        (window as any).AndroidInterface.sharePDF(
          result.pdfData,
          result.fileName || `Invoice_${safeId}.pdf`,
          shareTitle
        );
        success('Shared successfully via device!');
        onClose();
        return;
      }

      // Universal Share using Web Share API
      if (typeof navigator !== 'undefined' && navigator.share) {
        // Try file share first
        if (result?.pdfBlob && navigator.canShare) {
          const pdfFile = new File(
            [result.pdfBlob],
            result.fileName || `Invoice_${safeId}.pdf`,
            { type: 'application/pdf' }
          );
          if (navigator.canShare({ files: [pdfFile] })) {
            try {
              await navigator.share({
                title: shareTitle,
                text: shareText,
                files: [pdfFile],
              });
              success('Invoice shared successfully!');
              onClose();
              return;
            } catch (shareErr: any) {
              if (shareErr.name === 'AbortError') {
                return; // User cancelled
              }
              console.warn('Native file share failed, falling back to URL share:', shareErr);
            }
          }
        }

        // Try text & URL share via Web Share API
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: billUrl,
          });
          success('Invoice shared successfully!');
          onClose();
          return;
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
            return;
          }
          console.warn('Native text share failed:', shareErr);
        }
      }

      // Fallback for browsers that don't support navigator.share (e.g. desktop browser)
      if (customerPhone.trim()) {
        let formattedPhone = customerPhone.replace(/\D/g, '');
        if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
        else if (formattedPhone.startsWith('0')) formattedPhone = '91' + formattedPhone.substring(1);
        const waUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(shareText)}`;
        window.open(waUrl, '_blank');
        success('Opened WhatsApp share!');
        onClose();
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${billUrl}`);
        success('Invoice link copied to clipboard!');
        onClose();
      }
    } catch (err: any) {
      console.error('Error during universal share:', err);
      showError(err.message || 'Failed to share invoice');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-transparent backdrop-blur-xl bg-opacity-50 flex items-center justify-center z-[60]">
      <div ref={modalRef} className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-100 relative">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Share Invoice</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Details</label>
            <div className="space-y-3">
              <input
                type="text"
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setShowSuggestions(true); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Customer Name"
                onFocus={() => setShowSuggestions(true)}
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => { setCustomerPhone(e.target.value); setShowSuggestions(true); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Phone Number"
                onFocus={() => setShowSuggestions(true)}
              />
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Email Address (Optional)"
              />
            </div>

            {showSuggestions && filteredCustomers.length > 0 && (
              <div className="absolute left-0 right-0 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                {filteredCustomers.map(c => (
                  <div
                    key={c.id}
                    className="p-2 hover:bg-gray-50 cursor-pointer flex items-center gap-2"
                    onClick={() => selectCustomer(c)}
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.phone}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-50 p-3 rounded-lg">
            <h3 className="font-medium text-gray-800 mb-2">Invoice Summary</h3>
            <p className="text-sm text-gray-600">Item: {item.title}</p>
            <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
            <p className="text-sm font-medium text-gray-800">
              Total: Rs. {(item.sellingPrice * item.quantity).toFixed(2)}
            </p>
          </div>

          {/* Primary Action: Universal Share */}
          <button
            type="button"
            onClick={handleUniversalShare}
            disabled={isSharing}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-xl font-semibold shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            <Share2 className="w-5 h-5" />
            <span>{isSharing ? 'Sharing Invoice...' : 'Universal Share'}</span>
          </button>

          {/* Quick Alternative Channels */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleWhatsAppShare}
              disabled={isSharing}
              className="flex-1 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 py-2.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              <span>WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={handleEmailSend}
              disabled={isSharing}
              className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Mail className="w-4 h-4 text-blue-600" />
              <span>Email</span>
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors"
              title="Copy Invoice Link"
            >
              {copiedLink ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
        </div>
      </div>

      {isSharing && shareType === 'email' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/5 backdrop-blur-sm">
          <div className="w-64 h-64 md:w-80 md:h-80 bg-transparent flex flex-col items-center justify-center p-6">
            <Lottie animationData={EmailSentAnim} loop={true} className="w-48 h-48" />
            <p className="mt-4 text-xl font-bold text-blue-600 animate-pulse">Sending Email...</p>
          </div>
        </div>
      )}

      {showEmailSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/5 backdrop-blur-sm">
          <div className="w-64 h-64 md:w-80 md:h-80 bg-transparent flex flex-col items-center justify-center p-6">
            <Lottie animationData={SuccessAnim} loop={false} className="w-48 h-48" />
            <p className="mt-4 text-xl font-bold text-blue-600 animate-bounce">Email Sent!</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShareModal;