const fs = require('fs');

try {
  let code = fs.readFileSync('src/pages/Billing.tsx', 'utf8');

  // 1. Add useStore import and getCollectionRef, getDocRef
  if (!code.includes('useStore')) {
    code = code.replace(
      /import { useAuth } from '\.\.\/context\/AuthContext';/, 
      "import { useAuth } from '../context/AuthContext';\nimport { useStore } from '../context/StoreContext';"
    );
    code = code.replace(
      /const { currentUser } = useAuth\(\);/, 
      "const { currentUser } = useAuth();\n  const { getCollectionRef, getDocRef } = useStore();"
    );
  }

  // 2. Replace collection(db, 'name') with getCollectionRef('name')
  code = code.replace(/collection\(\s*db\s*,\s*'([^']+)'\s*\)/g, 'getCollectionRef(\'$1\')');

  // 3. Replace doc(db, 'collectionName', 'docId') with getDocRef('collectionName', 'docId')
  code = code.replace(/doc\(\s*db\s*,\s*'([^']+)'\s*,\s*([^)]+)\)/g, 'getDocRef(\'$1\', $2)');

  fs.writeFileSync('src/pages/Billing.tsx', code, 'utf8');
  console.log('Successfully refactored Billing.tsx');
} catch (error) {
  console.error('Error refactoring:', error);
}
