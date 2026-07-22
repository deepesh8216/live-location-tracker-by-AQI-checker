const fs = require("fs")
const path = require("path")

// Load secrets from .env without committing them to git
const envPath = path.join(__dirname, ".env")
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const value = trimmed.slice(eq + 1).trim()
        if (!process.env[key]) process.env[key] = value
    }
}

const { tunnel: cloudflaredTunnel } = require("cloudflared")
const cookieParser = require("cookie-parser")
const socketIO = require("socket.io")
const config = require("./config")
const express = require("express")
const tarkine = require("tarkine")
const http = require('http')

if (!config.username || !config.password || !config.token) {
    console.error("Missing ADMIN_USERNAME, ADMIN_PASSWORD, or AUTH_TOKEN in .env")
    process.exit(1)
}

const app = express()
const server = http.createServer(app)
const io = new socketIO.Server(server)
const PORT = process.env.PORT || config.port
global.remoteURL

global.IO = io

app.set("view engine", "html")
app.engine("html", tarkine.renderFile)
app.use(cookieParser())
app.use(express.urlencoded({ extended: false }))
app.use(express.static(__dirname + "/public"))
app.use(express.json())

app.use("/", require("./router"))

server.listen(PORT, async () => {
    const localURL = `http://localhost:${PORT}`
    remoteURL = await cloudflaredTunnel({
        "--url": localURL
    }).url

    console.log(`LOCAL  : ${localURL}`)
    console.log(`REMOTE : ${remoteURL}`)
})