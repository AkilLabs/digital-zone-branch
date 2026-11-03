# Billing System for Shop

A comprehensive billing system built with React, TypeScript, Vite, and Firebase for managing shop inventory and generating reports.

## Features

- **Authentication System**: Separate login for Owner and Employee roles
- **Billing Management**: Add, edit, and delete billing items
- **Auto-calculated Profit**: Automatically calculates profit based on cost and selling price
- **Real-time Data**: Firebase Firestore integration for real-time data sync
- **PDF Reports**: Generate detailed PDF reports with billing summaries
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Role-based Access**: Owners can delete items, employees can only add/edit

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Backend**: Firebase (Authentication & Firestore)
- **PDF Generation**: jsPDF + jsPDF-AutoTable
- **Routing**: React Router v6
- **Styling**: CSS3

## Prerequisites

Before you begin, ensure you have:
- Node.js (v16 or higher)
- npm or yarn
- A Firebase account

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use an existing one
3. Enable **Authentication** with Email/Password sign-in method
4. Create a **Firestore Database** in production mode
5. Add security rules to Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection - only authenticated users can read their own data
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Billing items - authenticated users can read and write
    match /billingItems/{itemId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      allow delete: if request.auth != null;
    }
  }
}
```

6. Create users manually in Firebase Authentication:
   - Go to Authentication > Users > Add user
   - Add email and password for owner
   - Add email and password for employee

7. Create user documents in Firestore:
   - Go to Firestore Database
   - Create a collection named `users`
   - For each user, create a document with:
     - Document ID: Same as the user's UID from Authentication
     - Fields:
       ```
       email: "owner@shop.com"
       role: "owner"  // or "employee"
       ```

8. Copy your Firebase configuration:
   - Go to Project Settings > General
   - Scroll down to "Your apps" section
   - Copy the Firebase config object

9. Update `src/config/firebase.ts` with your Firebase configuration:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Update Firebase configuration in `src/config/firebase.ts`

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Project Structure

```
src/
├── components/          # React components
│   ├── BillingForm.tsx     # Form to add/edit billing items
│   ├── BillingList.tsx     # Display list of billing items
│   ├── Login.tsx           # Login component
│   └── ProtectedRoute.tsx  # Route protection wrapper
├── config/             # Configuration files
│   └── firebase.ts         # Firebase configuration
├── context/            # React context
│   └── AuthContext.tsx     # Authentication context
├── pages/              # Page components
│   └── Dashboard.tsx       # Main dashboard page
├── styles/             # CSS styles
│   ├── BillingForm.css
│   ├── BillingList.css
│   ├── Dashboard.css
│   └── Login.css
├── types/              # TypeScript types
│   └── index.ts            # Type definitions
├── utils/              # Utility functions
│   └── pdfGenerator.ts     # PDF generation utility
├── App.tsx             # Main App component
└── main.tsx            # Entry point
```

## Usage

### Login
- Use the credentials you created in Firebase Authentication
- Owner and Employee have different permissions

### Add Billing Item
1. Fill in the form with:
   - Item Title
   - Cost Price
   - Selling Price
   - Quantity
2. Profit is calculated automatically
3. Click "Add Item"

### Edit Billing Item
1. Click "Edit" button on any item
2. Modify the fields
3. Click "Update Item"

### Delete Billing Item
- Only owners can delete items
- Click "Delete" button and confirm

### Generate PDF Report
1. Click "Generate PDF Report" button in the header
2. PDF will be downloaded automatically with:
   - Summary statistics
   - Detailed item table
   - Total profit/loss analysis

## Building for Production

```bash
npm run build
```

The build output will be in the `dist` directory.

## Deployment

You can deploy this application to:
- Firebase Hosting
- Vercel
- Netlify
- Any static hosting service

### Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## Security Notes

- Always keep your Firebase configuration secure
- Use environment variables for sensitive data in production
- Implement proper Firestore security rules
- Enable Firebase App Check for additional security
- Use HTTPS in production

## Troubleshooting

### Error: "Failed to load billing items"
- Check Firebase configuration
- Verify Firestore security rules
- Ensure user is authenticated

### Login not working
- Verify Firebase Authentication is enabled
- Check if Email/Password provider is enabled
- Ensure user exists in Firebase Authentication
- Verify user document exists in Firestore with correct role

## License

MIT

## Support

For issues and questions, please create an issue in the repository.
