package com.recallmobiles.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.Base64
import android.view.KeyEvent
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout
    
    // Change this to your website URL
    private val WEBSITE_URL = "https://recallmobiles.store/"
    
    private val PERMISSION_REQUEST_CODE = 123
    private val CAMERA_PERMISSION_REQUEST_CODE = 124
    private var permissionRequest: PermissionRequest? = null
    
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        // Initialize views
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)
        
        // Request permissions
        requestPermissions()
        
        // Configure WebView
        setupWebView()
        
        // Configure SwipeRefreshLayout
        swipeRefreshLayout.setOnRefreshListener {
            webView.reload()
        }
        
        // Load the website
        webView.loadUrl(WEBSITE_URL)
        
        // Auto-configure widget after page loads
        autoConfigureWidget()
        
        // Start attendance notification service (for owner users)
        startAttendanceNotificationService()
    }
    
    /**
     * Automatically configure widget by monitoring for Firebase user authentication
     */
    private fun autoConfigureWidget() {
        // Inject JavaScript to detect Firebase authentication and save user UID
        webView.postDelayed({
            val jsCode = """
                (function() {
                    console.log('[Widget] Starting auto-configuration...');
                    
                    let attempts = 0;
                    const maxAttempts = 30;
                    
                    const tryToConfigure = () => {
                        attempts++;
                        
                        let userId = null;
                        
                        // Method 1: Try Firebase Auth (most reliable)
                        if (window.firebase && window.firebase.auth) {
                            try {
                                const user = window.firebase.auth().currentUser;
                                if (user) {
                                    userId = user.uid;
                                    console.log('[Widget] Found Firebase user via firebase.auth()');
                                }
                            } catch (e) {
                                console.log('[Widget] Firebase auth not available:', e.message);
                            }
                        }
                        
                        // Method 2: Check localStorage for Firebase auth
                        if (!userId) {
                            try {
                                for (let i = 0; i < localStorage.length; i++) {
                                    const key = localStorage.key(i);
                                    if (key && key.includes('firebase:authUser')) {
                                        const authData = localStorage.getItem(key);
                                        if (authData) {
                                            const userData = JSON.parse(authData);
                                            if (userData.uid) {
                                                userId = userData.uid;
                                                console.log('[Widget] Found user ID in localStorage');
                                                break;
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.log('[Widget] Error checking localStorage:', e.message);
                            }
                        }
                        
                        // Configure widget if user found
                        if (userId && window.WidgetInterface) {
                            console.log('[Widget] Configuring widget with user ID:', userId);
                            window.WidgetInterface.configureWidget(userId);
                            console.log('[Widget] ✅ Configuration successful!');
                            
                            // Also show a toast to confirm
                            if (window.AndroidInterface) {
                                window.AndroidInterface.showToast('Widget configured successfully!');
                            }
                            
                            return true;
                        }
                        
                        // Keep trying
                        if (attempts < maxAttempts) {
                            setTimeout(tryToConfigure, 2000);
                        } else {
                            console.log('[Widget] ⚠️ Could not auto-configure after', attempts, 'attempts');
                            console.log('[Widget] Please configure manually via console');
                        }
                        
                        return false;
                    };
                    
                    // Start after page load
                    setTimeout(tryToConfigure, 1000);
                })();
            """.trimIndent()
            
            webView.evaluateJavascript(jsCode, null)
        }, 2000)
    }
    
    private fun startAttendanceNotificationService() {
        // The service will check if user is owner before starting
        try {
            val serviceIntent = Intent(this, AttendanceListenerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } catch (e: Exception) {
            // Service may not be needed for all users, ignore errors
        }
    }
    
    private fun requestPermissions() {
        val permissionsToRequest = mutableListOf<String>()
        
        // Camera permission for QR scanning
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA)
        }
        
        // Location permissions for attendance check-in/out
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        
        // Notification permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        
        // Storage permissions for older Android versions
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
        }
        
        if (permissionsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsToRequest.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
        }
    }
    
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            allowFileAccess = true
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        
        // Set WebViewClient
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }
            
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                swipeRefreshLayout.isRefreshing = false
                
                // Disable SwipeRefreshLayout for billing page
                if (url?.contains("/billing", ignoreCase = true) == true) {
                    swipeRefreshLayout.isEnabled = false
                } else {
                    swipeRefreshLayout.isEnabled = true
                }
            }
            
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                
                // Show error dialog
                if (request?.isForMainFrame == true) {
                    showErrorDialog()
                }
            }
            
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme ?: ""
                val host = uri.host ?: ""
                val path = uri.path ?: ""

                // Disable SwipeRefreshLayout for billing page
                if (path.contains("/billing", ignoreCase = true)) {
                    swipeRefreshLayout.isEnabled = false
                } else {
                    swipeRefreshLayout.isEnabled = true
                }

                // Open external apps/handlers for certain schemes/hosts
                return try {
                    when {
                        scheme.equals("mailto", ignoreCase = true) -> {
                            val intent = Intent(Intent.ACTION_SENDTO, uri)
                            startActivity(intent)
                            true
                        }
                        scheme.equals("tel", ignoreCase = true) -> {
                            val intent = Intent(Intent.ACTION_DIAL, uri)
                            startActivity(intent)
                            true
                        }
                        host.equals("wa.me", ignoreCase = true) || host.contains("whatsapp") -> {
                            val intent = Intent(Intent.ACTION_VIEW, uri)
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            startActivity(intent)
                            true
                        }
                        else -> false
                    }
                } catch (e: Exception) {
                    false
                }
            }
        }
        
        // Set WebChromeClient for better JavaScript support
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                progressBar.progress = newProgress
            }
            
            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Alert")
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result?.confirm() }
                    .setCancelable(false)
                    .create()
                    .show()
                return true
            }
            
            // Handle camera permission requests for QR scanning
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                
                runOnUiThread {
                    // Check if camera permission is requested
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        // Check if we have camera permission
                        if (ContextCompat.checkSelfPermission(
                                this@MainActivity,
                                Manifest.permission.CAMERA
                            ) == PackageManager.PERMISSION_GRANTED
                        ) {
                            // Grant the permission request
                            request.grant(request.resources)
                        } else {
                            // Store the request and ask user for permission
                            permissionRequest = request
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(Manifest.permission.CAMERA),
                                CAMERA_PERMISSION_REQUEST_CODE
                            )
                        }
                    } else {
                        request.deny()
                    }
                }
            }
            
            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                super.onPermissionRequestCanceled(request)
                permissionRequest = null
            }
        }
        
        // Add JavaScript interface for downloads
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidInterface")
        
        // Add JavaScript interface for widget configuration
        webView.addJavascriptInterface(WidgetConfigInterface(this), "WidgetInterface")
        
        // Set download listener
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
            handleDownload(url, contentDisposition, mimeType)
        }
    }
    
    private fun handleDownload(url: String, contentDisposition: String, mimeType: String) {
        try {
            // Check if it's a data URL (base64)
            if (url.startsWith("data:")) {
                handleDataUrlDownload(url, contentDisposition)
            } else {
                // Regular download
                val request = DownloadManager.Request(Uri.parse(url))
                request.setMimeType(mimeType)
                val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                
                Toast.makeText(this, "Downloading $filename", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }
    
    private fun handleDataUrlDownload(dataUrl: String, contentDisposition: String) {
        try {
            // Parse data URL
            val parts = dataUrl.split(",")
            if (parts.size != 2) return
            
            val header = parts[0]
            val data = parts[1]
            
            // Extract MIME type
            val mimeType = if (header.contains(";")) {
                header.substring(5, header.indexOf(";"))
            } else {
                "application/octet-stream"
            }
            
            // Decode base64
            val decodedBytes = Base64.decode(data, Base64.DEFAULT)
            
            // Generate filename
            val extension = when {
                mimeType.contains("pdf") -> "pdf"
                mimeType.contains("image") -> "jpg"
                else -> "file"
            }
            val filename = "DigitalZone_${System.currentTimeMillis()}.$extension"
            
            // Save to Downloads folder
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val file = File(downloadsDir, filename)
            
            FileOutputStream(file).use { output ->
                output.write(decodedBytes)
            }
            
            // Show success message
            runOnUiThread {
                Toast.makeText(this, "Downloaded: $filename", Toast.LENGTH_LONG).show()
            }
            
            // Notify media scanner
            val intent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
            intent.data = Uri.fromFile(file)
            sendBroadcast(intent)
            
        } catch (e: Exception) {
            runOnUiThread {
                Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
    
    inner class WebAppInterface(private val context: Context) {
        @JavascriptInterface
        fun downloadPDF(dataUrl: String, filename: String) {
            try {
                // Parse data URL
                val parts = dataUrl.split(",")
                if (parts.size != 2) {
                    showToast("Invalid data format")
                    return
                }
                
                val data = parts[1]
                val decodedBytes = Base64.decode(data, Base64.DEFAULT)
                
                // Save to Downloads folder
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val file = File(downloadsDir, filename)
                
                FileOutputStream(file).use { output ->
                    output.write(decodedBytes)
                }
                
                showToast("Downloaded: $filename")
                
                // Notify media scanner
                val intent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
                intent.data = Uri.fromFile(file)
                context.sendBroadcast(intent)
                
            } catch (e: Exception) {
                showToast("Download failed: ${e.message}")
            }
        }
        
        @JavascriptInterface
        fun sharePDF(dataUrl: String, filename: String, title: String) {
            try {
                // Parse data URL
                val parts = dataUrl.split(",")
                if (parts.size != 2) {
                    showToast("Invalid data format")
                    return
                }
                
                val header = parts[0]
                val data = parts[1]
                val decodedBytes = Base64.decode(data, Base64.DEFAULT)
                
                // Determine MIME type
                var mimeType = "application/octet-stream"
                if (header.contains(";")) {
                    try {
                        mimeType = header.substring(5, header.indexOf(";"))
                    } catch (_: Exception) {}
                }
                if (mimeType == "application/octet-stream") {
                    mimeType = when {
                        filename.endsWith(".pdf", true) -> "application/pdf"
                        filename.endsWith(".jpg", true) || filename.endsWith(".jpeg", true) -> "image/jpeg"
                        filename.endsWith(".png", true) -> "image/png"
                        else -> "application/octet-stream"
                    }
                }
                
                // Save to cache folder
                val cacheDir = context.cacheDir
                val file = File(cacheDir, filename)
                
                FileOutputStream(file).use { output ->
                    output.write(decodedBytes)
                }
                
                // Get URI using FileProvider
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file
                )
                
                // Create share intent
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, title)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                
                context.startActivity(Intent.createChooser(shareIntent, "Share via"))
                
            } catch (e: Exception) {
                showToast("Share failed: ${e.message}")
            }
        }
        
        private fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
    
    private fun showErrorDialog() {
        AlertDialog.Builder(this)
            .setTitle("Connection Error")
            .setMessage("Unable to connect to the server. Please check your internet connection and try again.")
            .setPositiveButton("Retry") { _, _ -> webView.reload() }
            .setNegativeButton("Cancel") { dialog, _ -> dialog.dismiss() }
            .create()
            .show()
    }
    
    // Handle back button press
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
    
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        
        when (requestCode) {
            CAMERA_PERMISSION_REQUEST_CODE -> {
                if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    // Camera permission granted, grant the web permission request
                    permissionRequest?.grant(permissionRequest?.resources)
                    Toast.makeText(this, "Camera permission granted", Toast.LENGTH_SHORT).show()
                } else {
                    // Camera permission denied
                    permissionRequest?.deny()
                    Toast.makeText(this, "Camera permission is required for QR scanning", Toast.LENGTH_LONG).show()
                }
                permissionRequest = null
            }
            PERMISSION_REQUEST_CODE -> {
                // Handle storage permissions
                val cameraGranted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
                if (cameraGranted) {
                    Toast.makeText(this, "Permissions granted", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
    
    override fun onDestroy() {
        // Stop camera stream if active
        webView.loadUrl("javascript:if(window.stopCameraStream){window.stopCameraStream();}")
        webView.destroy()
        super.onDestroy()
    }
}
