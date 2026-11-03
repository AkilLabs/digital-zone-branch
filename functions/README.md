# Email Invoice Function Setup

This Firebase Cloud Function sends invoice emails via ZeptoMail API.

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Configure ZeptoMail API Token

Set the ZeptoMail API token as an environment parameter:

```bash
firebase functions:secrets:set ZEPTO_TOKEN
# When prompted, paste your ZeptoMail API token
```

To get your ZeptoMail API token:
1. Go to [ZeptoMail](https://www.zoho.com/zeptomail/)
2. Sign in or create an account
3. Navigate to Settings > API
4. Copy your "Send Mail API" token

### 3. Build and Deploy

```bash
# Build the functions
npm run build

# Deploy to Firebase
npm run deploy
```

Or deploy all Firebase resources:

```bash
firebase deploy
```

### 4. Verify Deployment

After deployment, you should see:
```
✔  functions[sendInvoiceEmail(us-central1)] Successful create operation.
```

## Function Details

**Function Name:** `sendInvoiceEmail`

**Type:** Callable HTTPS Function (v2)

**Region:** us-central1 (default)

**Parameters:**
```typescript
{
  recipientEmail: string;      // Customer's email address
  recipientName: string;        // Customer's name
  pdfBase64: string;            // Base64-encoded PDF (without prefix)
  fileName: string;             // PDF filename
  invoiceData: {
    invoiceNumber: string;      // Invoice/Transaction ID
    customerName: string;       // Customer name
    totalAmount: number;        // Total invoice amount
    shopName: string;           // Shop name
  }
}
```

**Returns:**
```json
{
  "success": true,
  "message": "Email sent successfully",
  "messageId": "xxx-xxx-xxx"
}
```

## Email Template Features

📧 Professional HTML email with:
- Gradient header with shop branding
- Responsive design for mobile/desktop
- Invoice details table
- PDF attachment
- Shop footer with copyright

## Security

✅ **Authentication Required**: Function requires Firebase Auth token
✅ **Input Validation**: Validates all required fields  
✅ **Secret Management**: Uses Firebase Secrets for API token
✅ **Error Handling**: Comprehensive error logging

## Customer Data Integration

The function automatically updates customer records:
- Searches for customer by phone number in `customers` collection
- Updates email address if customer exists
- Silent fail if update fails (doesn't Block email)

## Testing

### Local Testing with Emulators

```bash
# Set secret for local testing
firebase functions:secrets:access ZEPTO_TOKEN

# Start emulators
npm run serve
```

### Production Testing

After deployment, test from your app:
1. Save an order in Billing page
2. Click "Email" button
3 Check Firebase Console > Functions > Logs for details

## Monitoring & Logs

### View Logs in Console
1. Go to Firebase Console
2. Functions section
3. Click `sendInvoiceEmail`
4. View "Logs" tab

### View Logs via CLI
```bash
npm run logs
```

### Common Log Messages
- ✅ `Sending email to: xxx@example.com`
- ✅ `Email sent successfully`
- ✅ `Customer email updated successfully`
- ❌ `ZeptoMail API error: ...`
- ❌ `Failed to send email: ...`

## Troubleshooting

### Error: "Email service not configured"
- Solution: Set ZEPTO_TOKEN secret using `firebase functions:secrets:set ZEPTO_TOKEN`

### Error: "Failed to send email: 401"
- Solution: Check if ZeptoMail API token is correct
- Verify token has "Send Mail" permissions

### Error: "Failed to send email: 400"
- Solution: Check email payload format
- Verify sender email is verified in ZeptoMail

### CORS Errors
- Not applicable - callable functions handle CORS automatically
- If seeing CORS errors, check function is deployed and client is authenticated

## Cost Estimation

Firebase Functions (v2):
- Free tier: 2M invocations/month
- After: $0.40 per million invocations

ZeptoMail:
- Free tier: 10,000 emails/month
-After: Refer to ZeptoMail pricing

## Next Steps

1. ✅ Deploy function: `npm run deploy`
2. ✅ Set ZEPTO_TOKEN secret
3. ✅ Verify sender email in ZeptoMail
4. ✅ Test from your app
5. ✅ Monitor logs for any issues
