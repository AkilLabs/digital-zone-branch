const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'pages');

function processFile(filePath) {
  try {
    let code = fs.readFileSync(filePath, 'utf8');

    // Skip if it doesn't have any db references to replace
    if (!code.includes('collection(db') && !code.includes('doc(db')) return;

    // We don't want to mess up Migration.tsx which explicitly accesses root collections
    if (path.basename(filePath) === 'Migration.tsx') return;

    // 1. Add useStore import and getCollectionRef, getDocRef
    if (!code.includes('useStore')) {
        // Find a place to inject the import
        if (code.includes(`import { useAuth } from '../context/AuthContext';`)) {
            code = code.replace(
                /import { useAuth } from '\.\.\/context\/AuthContext';/, 
                "import { useAuth } from '../context/AuthContext';\nimport { useStore } from '../context/StoreContext';"
            );
        } else {
            // Find last import
            const lastImportIndex = code.lastIndexOf('import ');
            const endOfLastImport = code.indexOf('\n', lastImportIndex);
            if (endOfLastImport !== -1) {
                code = code.slice(0, endOfLastImport) + `\nimport { useStore } from '../context/StoreContext';` + code.slice(endOfLastImport);
            }
        }
        
        // Find component start to inject hook usage
        // e.g. const Component = () => {  OR function Component() {
        // It's tricky to inject generically, but we can search for useAuth() hook since most pages use it
        if (code.includes(`useAuth();`)) {
            code = code.replace(
                /const\s+{?\s*(?:currentUser|user|logout|login)\s*}?\s*=\s*useAuth\(\);/,
                match => `${match}\n  const { getCollectionRef, getDocRef } = useStore();`
            );
        } else if (code.includes(`useNavigate();`)) {
             code = code.replace(
                /const\s+(?:navigate)\s*=\s*useNavigate\(\);/,
                match => `${match}\n  const { getCollectionRef, getDocRef } = useStore();`
            );
        } else {
            console.warn(`Could not find a place to inject useStore hook in ${filePath}. Skipping.`);
            return; // Skip so we don't break things
        }
    }

    let modified = false;

    // 2. Replace collection(db, 'name') with getCollectionRef('name')
    if (code.match(/collection\(\s*db\s*,\s*'([^']+)'\s*\)/)) {
        code = code.replace(/collection\(\s*db\s*,\s*'([^']+)'\s*\)/g, 'getCollectionRef(\'$1\')');
        modified = true;
    }

    // 3. Replace doc(db, 'collectionName', 'docId') with getDocRef('collectionName', 'docId')
    if (code.match(/doc\(\s*db\s*,\s*'([^']+)'\s*,\s*([^)]+)\)/)) {
        code = code.replace(/doc\(\s*db\s*,\s*'([^']+)'\s*,\s*([^)]+)\)/g, 'getDocRef(\'$1\', $2)');
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`Refactored ${path.basename(filePath)}`);
    }

  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

fs.readdirSync(pagesDir).forEach(file => {
  if (file.endsWith('.tsx')) {
    // Only process certain high value files to avoid breaking everything
    const targetFiles = [
        'Suppliers.tsx', 
        'OverallSales.tsx', 
        'RechargeAccounts.tsx', 
        'Purchases.tsx',
        'AddPurchase.tsx',
        'ServiceManagement.tsx',
        'EmployeeManagement.tsx',
        'AddExpense.tsx',
        'Dashboard.tsx'
    ];
    if (targetFiles.includes(file)) {
        processFile(path.join(pagesDir, file));
    }
  }
});

console.log('Batch refactor complete.');
