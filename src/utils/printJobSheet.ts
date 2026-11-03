import { db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { ServiceRequest, ShopDetails } from '../types';
import { generateServiceJobPDF } from './pdfGenerator';

export async function printJobSheet(job: ServiceRequest) {
  // Fetch shopDetails dynamically from Firestore
  let shopDetails: ShopDetails = {
    shopName: 'Digital Zone',
    ownerName: '',
    address: 'Your Company Address',
    phone: '+91-XXXXX XXXXX',
    email: 'support@digitalzone.com',
    gst: 'XXXXXXXXXXXXX',
    upiId: '',
    merchantName: ''
  };

  try {
    const docRef = doc(db, 'settings', 'shopDetails');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as ShopDetails;
      shopDetails = {
        ...shopDetails,
        ...data
      };
    }
  } catch (err) {
    console.error('Failed to fetch shopDetails in printJobSheet', err);
  }

  // Generate the premium PDF
  try {
    const result = await generateServiceJobPDF(job, shopDetails, true) as any;
    if (result && result.pdfBlob) {
      const blobUrl = URL.createObjectURL(result.pdfBlob);
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
      } else {
        // If window opening failed (popup blocker), download the PDF as a fallback
        const link = document.createElement('a');
        link.href = result.pdfData;
        link.download = result.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  } catch (err) {
    console.error('Failed to generate or print Job Sheet PDF', err);
  }
}
