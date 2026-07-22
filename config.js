module.exports = {
    port: Number(process.env.PORT) || 6589,
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    token: process.env.AUTH_TOKEN,
}
