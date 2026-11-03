import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    admin.initializeApp();
}

interface EmailData {
    recipientEmail: string;
    recipientName: string;
    pdfBase64: string;
    fileName: string;
    invoiceData: {
        invoiceNumber: string;
        customerName: string;
        totalAmount: number;
        shopName: string;
    };
}

export const sendInvoiceEmail = functions.https.onCall(
    async (data: EmailData, context: functions.https.CallableContext) => {
        // Verify user is authenticated
        if (!context.auth) {
            throw new functions.https.HttpsError(
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
        } = data;

        // Validate required fields
        if (!recipientEmail || !pdfBase64 || !fileName) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Missing required fields: recipientEmail, pdfBase64, or fileName'
            );
        }

        try {
            // ZeptoMail API configuration
            const ZEPTO_URL = 'https://api.zeptomail.in/v1.1/email';
            const ZEPTO_TOKEN = functions.config().zepto?.token;

            if (!ZEPTO_TOKEN) {
                console.error('ZeptoMail token not configured');
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'Email service not configured. Please contact administrator.'
                );
            }

            // Create HTML email body
            const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Invoice from ${invoiceData.shopName}</h1>
          </div>
          
          <div style="background: #f7fafc; padding: 30px; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px; color: #2d3748; margin-bottom: 20px;">
              Dear ${recipientName},
            </p>
            
            <p style="font-size: 14px; color: #4a5568; line-height: 1.6;">
              Thank you for your purchase! Please find your invoice attached to this email.
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h3 style="color: #2d3748; margin-top: 0;">Invoice Details:</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #718096;">Invoice Number:</td>
                  <td style="padding: 8px 0; color: #2d3748; font-weight: bold; text-align: right;">${invoiceData.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #718096;">Customer Name:</td>
                  <td style="padding: 8px 0; color: #2d3748; font-weight: bold; text-align: right;">${invoiceData.customerName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #718096;">Total Amount:</td>
                  <td style="padding: 8px 0; color: #667eea; font-weight: bold; text-align: right; font-size: 18px;">₹${invoiceData.totalAmount.toFixed(2)}</td>
                </tr>
              </table>
            </div>
            
            <p style="font-size: 14px; color: #4a5568; line-height: 1.6;">
              The invoice PDF is attached to this email. If you have any questions or concerns, please don't hesitate to contact us.
            </p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="font-size: 12px; color: #a0aec0; margin: 0;">
                This is an automated email. Please do not reply to this message.
              </p>
              <p style="font-size: 12px; color: #a0aec0; margin: 5px 0 0 0;">
                © ${new Date().getFullYear()} ${invoiceData.shopName}. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      `;

            // Prepare ZeptoMail request payload
            const emailPayload = {
                from: {
                    address: 'noreply@the-legend-mobiles.vercel.app',
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

            // Send email via ZeptoMail API using native fetch (Node 18+)
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
                throw new functions.https.HttpsError(
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
                    .where('phone', '==', data.invoiceData.customerName)
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
        } catch (error: any) {
            console.error('Error in sendInvoiceEmail:', error);

            // If it's already a Firebase error, rethrow it
            if (error.code && error.code.startsWith('functions/')) {
                throw error;
            }

            // Otherwise, wrap it in a Firebase error
            throw new functions.https.HttpsError(
                'internal',
                error.message || 'Failed to send email'
            );
        }
    }
);
