# Update Android App with latest web build
Write-Host "Updating Android app with latest web build..." -ForegroundColor Green

# Build the web app
Write-Host "`nBuilding web app..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ Web build completed successfully!" -ForegroundColor Green
    
    # Copy dist folder to Android assets
    $distPath = ".\dist\*"
    $androidAssetsPath = ".\android-app\app\src\main\assets\www"
    
    Write-Host "`nCopying files to Android app..." -ForegroundColor Yellow
    
    # Remove old assets
    if (Test-Path $androidAssetsPath) {
        Remove-Item -Path $androidAssetsPath -Recurse -Force
    }
    
    # Create assets directory
    New-Item -ItemType Directory -Force -Path $androidAssetsPath | Out-Null
    
    # Copy new build
    Copy-Item -Path $distPath -Destination $androidAssetsPath -Recurse -Force
    
    Write-Host "`n✓ Files copied successfully!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Open android-app folder in Android Studio"
    Write-Host "2. Build and run the app on your device"
    Write-Host "3. Navigate to the billing page"
    Write-Host "4. Test the scroll behavior - pull-to-refresh should now be disabled!"
} else {
    Write-Host "`n✗ Build failed!" -ForegroundColor Red
    exit 1
}
