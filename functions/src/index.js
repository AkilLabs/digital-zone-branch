const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { defineString } = require('firebase-functions/params');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define config parameter for ZeptoMail token
const zeptoToken = defineString('ZEPTO_TOKEN');

exports.sendInvoiceEmail = onCall(async (request) => {
  // Verify user is authenticated
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'User must be authenticated to send emails'
    );
  }

  const {
    recipientEmail,
    recipientName,
    pdfBase64,
    fileName,
    invoiceData,
  } = request.data;

  // Validate required fields
  if (!recipientEmail || !pdfBase64 || !fileName) {
    throw new HttpsError(
      'invalid-argument',
      'Missing required fields: recipientEmail, pdfBase64, or fileName'
    );
  }

  try {
    // ZeptoMail API configuration
    const ZEPTO_URL = 'https://api.zeptomail.in/v1.1/email';
    const ZEPTO_TOKEN = zeptoToken.value();

    if (!ZEPTO_TOKEN) {
      console.error('ZeptoMail token not configured');
      throw new HttpsError(
        'failed-precondition',
        'Email service not configured. Please contact administrator.'
      );
    }

    // Create HTML email body with professional design
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
        <!-- Logo Header -->
        <div style="text-align: center; padding: 40px 20px; background-color: #ffffff; border-bottom: 3px solid #2563eb;">
          <img src="https://www.maxmobiles.store/logo.png" alt="${invoiceData.shopName}" style="max-width: 100px; height: auto; margin-bottom: 20px;" />
          <h1 style="color: #1e293b; margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.5px;">Invoice from ${invoiceData.shopName}</h1>
          <p style="color: #64748b; margin: 10px 0 0 0; font-size: 15px; font-weight: 400;">Thank you for your purchase</p>
        </div>
        
        <!-- Email Body -->
        <div style="background-color: #ffffff; padding: 40px 30px;">
          <p style="font-size: 16px; color: #1e293b; margin: 0 0 20px 0; line-height: 1.6; font-weight: 500;">
            Dear ${recipientName},
          </p>
          
          <p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 0 0 30px 0;">
            Thank you for choosing ${invoiceData.shopName}. We appreciate your business and hope you're satisfied with your purchase. Your invoice is attached to this email for your records.
          </p>
          
          <!-- Invoice Details Card -->
          <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin: 30px 0; border: 1px solid #e2e8f0;">
            <h3 style="color: #1e293b; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Invoice Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 0; color: #64748b; font-size: 14px; font-weight: 500;">Invoice Number:</td>
                <td style="padding: 12px 0; color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${invoiceData.invoiceNumber}</td>
              </tr>
              <tr style="border-top: 1px solid #e2e8f0;">
                <td style="padding: 12px 0; color: #64748b; font-size: 14px; font-weight: 500;">Customer Name:</td>
                <td style="padding: 12px 0; color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${invoiceData.customerName}</td>
              </tr>
              <tr style="border-top: 1px solid #e2e8f0;">
                <td style="padding: 12px 0; color: #64748b; font-size: 14px; font-weight: 500;">Total Amount:</td>
                <td style="padding: 12px 0; color: #2563eb; font-weight: 700; text-align: right; font-size: 22px;">₹${invoiceData.totalAmount.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <!-- Attachment Notice -->
          <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; border-radius: 4px; padding: 20px; margin: 30px 0;">
            <p style="margin: 0; color: #1e40af; font-size: 15px; line-height: 1.6; font-weight: 500;">
              PDF Invoice Attached
            </p>
            <p style="margin: 8px 0 0 0; color: #475569; font-size: 14px; line-height: 1.6;">
              The complete invoice has been attached to this email as a PDF file. You can download, print, or save it for your records.
            </p>
          </div>
          
          <p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 30px 0 0 0;">
            If you have any questions about your purchase or this invoice, please don't hesitate to contact us. We're always here to help.
          </p>
          
          <!-- Call to Action -->
          <div style="text-align: center; margin: 40px 0;">
            <a href="https://www.maxmobiles.store" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">Visit Our Store</a>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 13px; color: #64748b; margin: 0 0 8px 0; line-height: 1.6;">
            This is an automated email from ${invoiceData.shopName}.
          </p>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 15px 0; line-height: 1.6;">
            Please do not reply directly to this message.
          </p>
          <p style="font-size: 12px; color: #94a3b8; margin: 0;">
            &copy; ${new Date().getFullYear()} ${invoiceData.shopName}. All rights reserved.
          </p>
        </div>
      </div>
    `;

    // Prepare ZeptoMail request payload
    const emailPayload = {
      from: {
        address: 'noreply@maxmobiles.store',
        name: invoiceData.shopName,
      },
      to: [
        {
          email_address: {
            address: recipientEmail,
            name: recipientName,
          },
        },
      ],
      subject: `Invoice ${invoiceData.invoiceNumber} from ${invoiceData.shopName}`,
      htmlbody: htmlBody,
      attachments: [
        {
          content: pdfBase64,
          'mime_type': 'application/pdf',
          name: fileName,
        },
      ],
    };

    console.log('Sending email to:', recipientEmail);

    // Send email via ZeptoMail API
    const response = await fetch(ZEPTO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ZEPTO_TOKEN,
      },
      body: JSON.stringify(emailPayload),
    });

    const responseText = await response.text();
    console.log('ZeptoMail response status:', response.status);
    console.log('ZeptoMail response:', responseText);

    if (!response.ok) {
      console.error('ZeptoMail API error:', responseText);
      throw new HttpsError(
        'internal',
        `Failed to send email: ${response.status} - ${responseText.substring(0, 200)}`
      );
    }

    const result = JSON.parse(responseText);
    console.log('Email sent successfully:', result);

    // Update customer record with email (if customer exists)
    try {
      const db = admin.firestore();
      const customersRef = db.collection('customers');
      const customerQuery = await customersRef
        .where('phone', '==', invoiceData.customerName)
        .limit(1)
        .get();

      if (!customerQuery.empty) {
        const customerDoc = customerQuery.docs[0];
        await customerDoc.ref.update({
          email: recipientEmail,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('Customer email updated successfully');
      }
    } catch (updateError) {
      console.error('Error updating customer email:', updateError);
      // Don't fail the entire function if customer update fails
    }

    return {
      success: true,
      message: 'Email sent successfully',
      messageId: result.data?.[0]?.message_id || 'unknown',
    };
  } catch (error) {
    console.error('Error in sendInvoiceEmail:', error);

    // If it's already a Firebase error, rethrow it
    if (error.code && error.code.startsWith('functions/')) {
      throw error;
    }

    // Otherwise, wrap it in a Firebase error
    throw new HttpsError(
      'internal',
      error.message || 'Failed to send email'
    );
  }
});
