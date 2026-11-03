const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');

// Initialize Firebase Admin (Singleton)
if (!admin.apps.length) {
    try {
        // If running in Vercel, use environment variables
        if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    // Replace escaped newlines if necessary
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
        } else {
            console.warn('Firebase Admin credentials not found in environment variables.');
        }
    } catch (error) {
        console.error('Firebase Admin initialization error:', error);
    }
}

module.exports = async (req, res) => {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
        return res.status(400).send('Bill ID (transactionId) is required');
    }

    try {
        if (!admin.apps.length) {
            console.error('Firebase Admin not initialized');
            return res.status(500).send('Server configuration error: Firebase Admin not initialized.');
        }

        const db = admin.firestore();

        // Try 'transactions' collection first
        let docSnap = await db.collection('transactions').doc(id).get();

        // If not found by document ID, try querying by transactionId field
        if (!docSnap.exists) {
            const snapshot = await db.collection('transactions').where('transactionId', '==', id).limit(1).get();
            if (!snapshot.empty) {
                docSnap = snapshot.docs[0];
            }
        }

        if (!docSnap.exists) {
            return res.status(404).send('Bill not found');
        }

        const bill = docSnap.data();

        // Resolve items
        let items = bill.items || [];
        if (!items || items.length === 0) {
            const itemsSnap = await db.collection('billingItems')
                .where('transactionId', '==', bill.transactionId || id)
                .get();
            items = itemsSnap.docs.map(doc => doc.data());

            if (items.length === 0) {
                const creditSnap = await db.collection('creditSales')
                    .where('transactionId', '==', bill.transactionId || id)
                    .get();
                items = creditSnap.docs.map(doc => doc.data());
            }
        }

        // Generate PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Invoice-${id}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).text(bill.shopName || 'Max Mobiles', { align: 'center' });
        doc.fontSize(10).text(bill.shopAddress || 'Store Address', { align: 'center' });
        doc.text(`Phone: ${bill.shopPhone || ''}`, { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`Invoice: ${bill.transactionId || id}`);
        // Check timestamp
        let dateStr = new Date().toLocaleDateString();
        if (bill.createdAt) {
            if (typeof bill.createdAt.toDate === 'function') {
                dateStr = bill.createdAt.toDate().toLocaleDateString();
            } else {
                dateStr = new Date(bill.createdAt).toLocaleDateString();
            }
        }

        doc.text(`Date: ${dateStr}`);
        doc.text(`Customer: ${bill.customerName || 'Walk-in'}`);
        if (bill.customerPhone) doc.text(`Phone: ${bill.customerPhone}`);
        doc.moveDown();

        // Table Header
        const tableTop = doc.y;
        doc.font('Helvetica-Bold');
        doc.text('Item', 50, tableTop);
        doc.text('Qty', 300, tableTop);
        doc.text('Price', 350, tableTop);
        doc.text('Total', 450, tableTop);
        doc.moveDown(0.5);

        // Draw line
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica');

        // Items
        let subtotal = 0;
        items.forEach((item) => {
            const y = doc.y;
            const title = item.title || item.name || 'Item';
            const qty = Number(item.quantity) || 1;
            const price = Number(item.sellingPrice || item.price) || 0;
            const total = price * qty;
            subtotal += total;

            doc.text(title, 50, y);
            doc.text(qty.toString(), 300, y);
            doc.text(price.toFixed(2), 350, y);
            doc.text(total.toFixed(2), 450, y);
            doc.moveDown(0.5);
        });

        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Summary
        doc.font('Helvetica-Bold');
        doc.text(`Subtotal: ${subtotal.toFixed(2)}`, { align: 'right' });

        if (bill.discountAmount > 0) {
            doc.text(`Discount: -${Number(bill.discountAmount).toFixed(2)}`, { align: 'right' });
        }

        if (bill.gstAmount > 0) {
            doc.text(`GST (${bill.gstRate}%): ${Number(bill.gstAmount).toFixed(2)}`, { align: 'right' });
        }

        const finalTotal = Number(bill.grandTotal || bill.total || subtotal);
        doc.fontSize(14).text(`Grand Total: ${finalTotal.toFixed(2)}`, { align: 'right' });

        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica').text('Thank you for your business!', { align: 'center' });

        doc.end();

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).send('Internal Server Error generating PDF: ' + error.message);
    }
};
