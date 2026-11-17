package com.alpgroup.shinesanitize.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors

/**
 * Service persistant en premier plan (Foreground Service) pour les agents terrain Shine x Sanitize (Alp Group).
 * Maintient l'envoi GPS (Latitude, Longitude) toutes les 6 secondes vers le serveur même écran éteint,
 * application minimisée ou lors de l'utilisation de Google Maps / Waze à Libreville, Akanda & Owendo.
 * Inclut un tampon hors-ligne et une reprise automatique immédiate dès le retour du réseau.
 */
class AgentLocationForegroundService : Service() {

    data class BufferedPoint(
        val lat: Double,
        val lng: Double,
        val accuracy: Float,
        val speedKmh: Double,
        val capturedAtIso: String
    )

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var connectivityManager: ConnectivityManager
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var locationCallback: LocationCallback? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val offlineQueue = ConcurrentLinkedQueue<BufferedPoint>()

    private var apiBaseUrl: String = ""
    private var authToken: String = ""
    private var orderId: String = ""
    private var agentId: String = ""

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        createNotificationChannel()
        registerNetworkRecoveryCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelfCleanly()
            return START_NOT_STICKY
        }

        apiBaseUrl = intent?.getStringExtra(EXTRA_API_BASE_URL) ?: apiBaseUrl
        authToken = intent?.getStringExtra(EXTRA_AUTH_TOKEN) ?: authToken
        orderId = intent?.getStringExtra(EXTRA_ORDER_ID) ?: orderId
        agentId = intent?.getStringExtra(EXTRA_AGENT_ID) ?: agentId

        val notification = buildPersistentNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        acquireWakeLock()
        startLocationUpdates()
        return START_STICKY
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ShineSanitize::AgentGpsWakeLock")
        wakeLock?.setReferenceCounted(false)
        wakeLock?.acquire()
    }

    private fun registerNetworkRecoveryCallback() {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                flushBufferedPoints()
            }
        }

        try {
            connectivityManager.registerNetworkCallback(request, networkCallback!!)
        } catch (_: Exception) {
            // Fallback to periodic 6s flush inside location ticks
        }
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 6000L)
            .setMinUpdateIntervalMillis(5000L)
            .setMaxUpdateDelayMillis(8000L)
            .build()

        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                enqueueAndFlushLocation(loc)
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (_: SecurityException) {
            stopSelfCleanly()
        }
    }

    private fun formatIsoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    private fun enqueueAndFlushLocation(loc: Location) {
        val speedKmh = if (loc.hasSpeed()) loc.speed * 3.6 else 0.0
        offlineQueue.add(
            BufferedPoint(
                lat = loc.latitude,
                lng = loc.longitude,
                accuracy = loc.accuracy,
                speedKmh = speedKmh,
                capturedAtIso = formatIsoNow()
            )
        )
        while (offlineQueue.size > 60) {
            offlineQueue.poll()
        }
        flushBufferedPoints()
    }

    private fun flushBufferedPoints() {
        if (apiBaseUrl.isBlank()) return
        ioExecutor.execute {
            val endpoint = if (orderId.isNotBlank()) {
                "$apiBaseUrl/api/orders/$orderId/gps"
            } else if (agentId.isNotBlank()) {
                "$apiBaseUrl/api/agents/$agentId/gps-heartbeat"
            } else {
                return@execute
            }

            while (true) {
                val point = offlineQueue.peek() ?: break
                try {
                    val url = URL(endpoint)
                    val conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 5000
                        readTimeout = 5000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                        if (authToken.isNotBlank()) {
                            setRequestProperty("Authorization", "Bearer $authToken")
                        }
                    }
                    val payload = """
                        {
                          "lat": ${point.lat},
                          "lng": ${point.lng},
                          "accuracyMeters": ${point.accuracy.toInt()},
                          "speedKmh": ${point.speedKmh},
                          "capturedAt": "${point.capturedAtIso}",
                          "source": "agent_app",
                          "backgroundMode": "native_bridge",
                          "permissionMode": "always_allow",
                          "orderId": "$orderId"
                        }
                    """.trimIndent()
                    OutputStreamWriter(conn.outputStream).use { it.write(payload) }
                    val code = conn.responseCode
                    conn.disconnect()
                    if (code in 200..299) {
                        offlineQueue.poll()
                    } else {
                        break
                    }
                } catch (_: Exception) {
                    // Micro-coupure réseau : point conservé en file d'attente pour reprise instantanée au retour du signal
                    break
                }
            }
        }
    }

    private fun buildPersistentNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Shine x Sanitize : Suivi GPS actif pour la mission en cours")
            .setContentText("Synchronisation temps réel toutes les 6s (Libreville, Akanda & Owendo)")
            .setSmallIcon(resources.getIdentifier("ic_stat_shine_sanitize", "drawable", packageName))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Suivi GPS Agent en mission",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Maintient le suivi GPS actif en arrière-plan pendant les interventions Shine x Sanitize."
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun stopSelfCleanly() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
            } catch (_: Exception) {
            }
        }
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        ioExecutor.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "shine_agent_gps_foreground"
        const val NOTIFICATION_ID = 4092
        const val ACTION_STOP = "com.alpgroup.shinesanitize.STOP_GPS_SERVICE"
        const val EXTRA_API_BASE_URL = "api_base_url"
        const val EXTRA_AUTH_TOKEN = "auth_token"
        const val EXTRA_ORDER_ID = "order_id"
        const val EXTRA_AGENT_ID = "agent_id"
    }
}
