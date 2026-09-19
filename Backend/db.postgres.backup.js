const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "voice_maintenance_db",
  password: "1326",
  port: 5432,
});

module.exports = pool;